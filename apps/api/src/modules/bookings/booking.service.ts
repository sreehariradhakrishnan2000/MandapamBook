import { randomInt } from 'node:crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { BOOKING_REF_ALPHABET } from '@mandapambook/shared';
import { type Db, PG_ERROR, lockHallDate, pgConstraint, pgErrorCode } from '../../db/client.js';
import { bookingAddons, bookingStatusHistory, bookings, payments } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { todayInIst } from '../../lib/time.js';
import type { AuditContext, AuditService } from '../audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { type RefundPreview, previewRefund } from './cancellation.js';
import type { QuoteRequestInput, QuoteService } from './quote.service.js';
import {
  type BookingStatus,
  StaleBookingError,
  canTransition,
  transition,
} from './state-machine.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type BookingRow = typeof bookings.$inferSelect;

const UNPAID: BookingStatus[] = ['HELD', 'PENDING_PAYMENT'];

export function newRefCode(): string {
  let code = 'MB-';
  for (let i = 0; i < 6; i++) code += BOOKING_REF_ALPHABET[randomInt(BOOKING_REF_ALPHABET.length)];
  return code;
}

export class BookingService {
  constructor(
    private readonly db: Db,
    private readonly quotes: QuoteService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Holds a slot for the customer while they pay. In one transaction: expire any holds on
   * this hall and date whose time ran out (so the slot frees exactly on time, not when the
   * sweeper next runs), price the booking from the server's own rules, and insert it. The
   * database rejects the insert if the slot is taken (exclusion constraint) or the customer
   * already has an unpaid hold (partial unique index).
   */
  async hold(
    customerId: string,
    req: QuoteRequestInput,
    ctx: AuditContext,
  ): Promise<{ booking: BookingRow; quote: Awaited<ReturnType<QuoteService['quote']>>['view'] }> {
    const settings = await this.settings.get();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          // Concurrent holds for this hall and date queue here, so the later ones see the
          // slot as taken (409) instead of deadlocking on the exclusion constraint.
          await lockHallDate(tx, req.hallId, req.eventDate);
          await this.expireStale(tx, { hallId: req.hallId, eventDate: req.eventDate });
          await this.expireStale(tx, { customerId });
          const priced = await this.quotes.quote(req, tx);
          if (!priced.view.available)
            throw errors.conflict(
              'SLOT_UNAVAILABLE',
              'That slot was just booked. Choose another date or slot.',
            );
          const holdExpiresAt = new Date(Date.now() + settings.hold_minutes * 60_000);
          const [booking] = await tx
            .insert(bookings)
            .values({
              refCode: newRefCode(),
              customerId,
              auditoriumId: priced.auditoriumId,
              hallId: req.hallId,
              eventDate: req.eventDate,
              slot: req.slot,
              guestCount: req.guestCount,
              status: 'HELD',
              holdExpiresAt,
              subtotalPaise: priced.view.basePaise,
              addonsPaise: priced.view.addonsPaise,
              gstPaise: priced.view.gstPaise,
              platformFeePaise: priced.view.platformFeePaise,
              totalPaise: priced.view.totalPaise,
              advancePaise: priced.view.payNowPaise,
              priceSnapshot: priced.snapshot,
            })
            .returning();
          if (!booking) throw new Error('booking insert returned nothing');
          if (priced.view.addons.length) {
            await tx.insert(bookingAddons).values(
              priced.view.addons.map((a) => ({
                bookingId: booking.id,
                addonId: a.addonId,
                quantity: a.quantity,
                unitPricePaise: a.unitPaise,
                totalPaise: a.totalPaise,
              })),
            );
          }
          await tx.insert(bookingStatusHistory).values({
            bookingId: booking.id,
            fromStatus: null,
            toStatus: 'HELD',
            actorId: customerId,
          });
          await this.audit.record(
            {
              action: 'booking.held',
              entityType: 'booking',
              entityId: booking.id,
              actorId: customerId,
              actorRole: 'CUSTOMER',
              after: {
                hallId: req.hallId,
                eventDate: req.eventDate,
                slot: req.slot,
                totalPaise: booking.totalPaise,
              },
            },
            ctx,
            tx,
          );
          return { booking, quote: priced.view };
        });
      } catch (err) {
        const code = pgErrorCode(err);
        if (code === PG_ERROR.EXCLUSION_VIOLATION) {
          throw errors.conflict(
            'SLOT_UNAVAILABLE',
            'That slot was just booked. Choose another date or slot.',
          );
        }
        if (
          code === PG_ERROR.UNIQUE_VIOLATION &&
          pgConstraint(err) === 'bookings_one_active_hold_per_customer'
        ) {
          throw errors.conflict(
            'HOLD_EXISTS',
            'You already have a date on hold. Pay for it or cancel it first.',
          );
        }
        // Reference code collision (1 in ~10^9): try again with a new code.
        if (code === PG_ERROR.UNIQUE_VIOLATION && pgConstraint(err) === 'bookings_ref_code_key')
          continue;
        // Defence in depth: lockHallDate prevents the known deadlock, but if one still
        // happens Postgres has rolled this transaction back, so retrying is safe.
        if (code === PG_ERROR.DEADLOCK_DETECTED) continue;
        throw err;
      }
    }
    throw new Error('could not place the hold after retries');
  }

  /** Marks unpaid holds past their expiry as EXPIRED. Returns how many were expired. */
  async expireStale(
    tx: Tx,
    scope: { hallId?: string; eventDate?: string; customerId?: string } = {},
    limit = 500,
  ): Promise<number> {
    const stale = await tx
      .select({ id: bookings.id, status: bookings.status, version: bookings.version })
      .from(bookings)
      .where(
        and(
          inArray(bookings.status, UNPAID),
          lt(bookings.holdExpiresAt, new Date()),
          scope.hallId ? eq(bookings.hallId, scope.hallId) : undefined,
          scope.eventDate ? eq(bookings.eventDate, scope.eventDate) : undefined,
          scope.customerId ? eq(bookings.customerId, scope.customerId) : undefined,
        ),
      )
      .limit(limit)
      .for('update', { skipLocked: true });
    for (const b of stale) {
      await transition(tx, {
        bookingId: b.id,
        from: b.status,
        to: 'EXPIRED',
        version: b.version,
        reason: 'hold_expired',
      });
    }
    return stale.length;
  }

  /** Amount actually collected online for a booking (captured minus refunded). */
  async paidOnline(bookingId: string, tx?: Tx): Promise<number> {
    const [row] = await (tx ?? this.db)
      .select({
        paid: sql<string>`COALESCE(SUM(${payments.amountPaise} - ${payments.refundedPaise}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.bookingId, bookingId),
          inArray(payments.status, ['CAPTURED', 'PARTIALLY_REFUNDED']),
        ),
      );
    return Number(row?.paid ?? 0);
  }

  async refundPreview(booking: BookingRow, tx?: Tx): Promise<RefundPreview> {
    return previewRefund({
      tiers: booking.priceSnapshot.cancellationTiers,
      today: todayInIst(),
      eventDate: booking.eventDate,
      paidPaise: await this.paidOnline(booking.id, tx),
      platformFeePaise: booking.platformFeePaise,
    });
  }

  /**
   * Customer cancellation. Unpaid holds are simply released. Paid bookings move to
   * CANCELLED with the refund owed fixed now (by the policy tier for today's date);
   * the payments module pays it and moves the booking to REFUNDED.
   */
  async cancel(
    customerId: string,
    bookingId: string,
    reason: string | undefined,
    ctx: AuditContext,
  ) {
    return this.db.transaction(async (tx) => {
      const [b] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.customerId, customerId)))
        .for('update');
      if (!b) throw errors.notFound('Booking not found');
      if (!canTransition(b.status, 'CANCELLED')) {
        throw errors.conflict(
          'NOT_CANCELLABLE',
          `A ${b.status.toLowerCase().replace('_', ' ')} booking cannot be cancelled`,
        );
      }
      if (b.eventDate < todayInIst())
        throw errors.conflict('NOT_CANCELLABLE', 'This event date has passed');
      const preview = await this.refundPreview(b, tx);
      try {
        const updated = await transition(tx, {
          bookingId: b.id,
          from: b.status,
          to: 'CANCELLED',
          version: b.version,
          actorId: customerId,
          reason: reason ?? 'cancelled_by_customer',
          set: {
            cancelledAt: new Date(),
            cancelledBy: customerId,
            cancellationReason: reason ?? null,
            refundDuePaise: preview.refundPaise > 0 ? preview.refundPaise : null,
          },
        });
        await this.audit.record(
          {
            action: 'booking.cancelled',
            entityType: 'booking',
            entityId: b.id,
            actorId: customerId,
            before: { status: b.status },
            after: { status: 'CANCELLED', refundDuePaise: preview.refundPaise, rule: preview.rule },
          },
          ctx,
          tx,
        );
        return { booking: updated, refund: preview };
      } catch (err) {
        if (err instanceof StaleBookingError)
          throw errors.conflict(
            'BOOKING_CHANGED',
            'This booking just changed. Reload and try again.',
          );
        throw err;
      }
    });
  }
}
