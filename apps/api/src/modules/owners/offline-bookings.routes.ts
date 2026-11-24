import { Router } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { offlineBookingSchema, offlineBookingUpdateSchema } from '@mandapambook/shared';
import { z } from 'zod';
import { type Db, PG_ERROR, lockHallDate, pgErrorCode } from '../../db/client.js';
import { availabilityBlocks, halls, offlineBookings } from '../../db/schema/index.js';
import { HttpError, errors } from '../../http/errors.js';
import { todayInIst } from '../../lib/time.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import type { ScopedResources } from './scoped.js';

type OfflineRow = typeof offlineBookings.$inferSelect;

const listQuerySchema = z.strictObject({
  status: z.enum(['ACTIVE', 'CANCELLED', 'ALL']).default('ACTIVE'),
});

/** The audit trail records what changed, never the guest's phone number in full. */
function maskedPhone(phone: string): string {
  return `${phone.slice(0, 3)}••••••${phone.slice(-4)}`;
}

/**
 * Bookings a venue took outside MandapamBook (phone, walk-in). Each one holds its dates
 * through availability blocks, so the same database constraint that stops double bookings
 * online also stops an online booking on an offline date, and the reverse.
 */
export function offlineBookingsRouter(deps: {
  db: Db;
  scoped: ScopedResources;
  audit: AuditService;
}): Router {
  const { db, scoped, audit } = deps;
  const r = Router();

  async function withSlots(rows: OfflineRow[]) {
    const ids = rows.map((b) => b.id);
    const blocks = ids.length
      ? await db
          .select({
            offlineBookingId: availabilityBlocks.offlineBookingId,
            eventDate: availabilityBlocks.eventDate,
            slot: availabilityBlocks.slot,
          })
          .from(availabilityBlocks)
          .where(inArray(availabilityBlocks.offlineBookingId, ids))
          .orderBy(asc(availabilityBlocks.eventDate))
      : [];
    const hallNames = new Map(
      rows.length
        ? (
            await db
              .select({ id: halls.id, name: halls.name })
              .from(halls)
              .where(inArray(halls.id, [...new Set(rows.map((b) => b.hallId))]))
          ).map((h) => [h.id, h.name])
        : [],
    );
    return rows.map((b) => ({
      id: b.id,
      hallId: b.hallId,
      hallName: hallNames.get(b.hallId) ?? '',
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      customerEmail: b.customerEmail,
      eventType: b.eventType,
      amountPaise: b.amountPaise,
      advancePaise: b.advancePaise,
      notes: b.notes,
      status: b.status,
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      slots: blocks
        .filter((x) => x.offlineBookingId === b.id)
        .map((x) => ({ eventDate: x.eventDate, slot: x.slot })),
    }));
  }

  r.get(
    '/auditoriums/:id/offline-bookings',
    requirePermission('calendar:manage'),
    async (req, res) => {
      const scope = await scoped.scope(req);
      const venue = await scoped.auditorium(scope, req.params['id']);
      const { status } = listQuerySchema.parse(req.query);
      const rows = await db
        .select()
        .from(offlineBookings)
        .where(
          and(
            eq(offlineBookings.auditoriumId, venue.id),
            status === 'ALL' ? undefined : eq(offlineBookings.status, status),
          ),
        )
        .orderBy(asc(offlineBookings.createdAt));
      const items = await withSlots(rows);
      // Soonest event first; bookings with no dates left (cancelled) go last.
      items.sort((a, b) =>
        (a.slots[0]?.eventDate ?? '9999').localeCompare(b.slots[0]?.eventDate ?? '9999'),
      );
      res.set('Cache-Control', 'no-store').json({ items });
    },
  );

  r.post(
    '/auditoriums/:id/offline-bookings',
    requirePermission('calendar:manage'),
    async (req, res) => {
      const me = currentUser(req);
      const scope = await scoped.scope(req);
      const venue = await scoped.auditorium(scope, req.params['id']);
      const input = offlineBookingSchema.parse(req.body);
      const hall = await scoped.hall(scope, input.hallId);
      if (hall.auditoriumId !== venue.id) throw errors.notFound();
      const today = todayInIst();
      if (input.slots.some((s) => s.eventDate < today)) {
        throw errors.badRequest('DATE_IN_PAST', 'You can only add today or future dates');
      }

      const { slots, ...details } = input;
      let created: OfflineRow;
      try {
        created = await db.transaction(async (tx) => {
          // Same hall/date locks as online holds, taken in date order so two owners adding
          // overlapping ranges queue instead of deadlocking.
          for (const date of [...new Set(slots.map((s) => s.eventDate))].sort()) {
            await lockHallDate(tx, hall.id, date);
          }
          const [row] = await tx
            .insert(offlineBookings)
            .values({ ...details, auditoriumId: venue.id, hallId: hall.id, createdBy: me.userId })
            .returning();
          if (!row) throw new Error('offline booking insert returned nothing');
          for (const s of slots) {
            try {
              await tx.insert(availabilityBlocks).values({
                hallId: hall.id,
                eventDate: s.eventDate,
                slot: s.slot,
                reason: 'Booked offline',
                offlineBookingId: row.id,
                createdBy: me.userId,
              });
            } catch (err) {
              if (pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION) {
                throw errors.conflict(
                  'SLOT_UNAVAILABLE',
                  `${s.eventDate} (${s.slot.replace('_', ' ').toLowerCase()}) is already booked or blocked`,
                );
              }
              throw err;
            }
          }
          return row;
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION) {
          throw errors.conflict(
            'SLOT_UNAVAILABLE',
            'One of those dates is already booked or blocked',
          );
        }
        throw err;
      }

      await audit.record(
        {
          action: 'offline_booking.created',
          entityType: 'offline_booking',
          entityId: created.id,
          actorId: me.userId,
          actorRole: me.role,
          after: {
            hallId: hall.id,
            slots,
            customerName: created.customerName,
            customerPhone: maskedPhone(created.customerPhone),
          },
        },
        auditContext(req),
      );
      const [item] = await withSlots([created]);
      res.status(201).json(item);
    },
  );

  r.patch('/offline-bookings/:id', requirePermission('calendar:manage'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    const booking = await scoped.offlineBooking(scope, req.params['id']);
    if (booking.status !== 'ACTIVE') {
      throw errors.conflict('OFFLINE_BOOKING_CANCELLED', 'A cancelled booking cannot be edited');
    }
    const input = offlineBookingUpdateSchema.parse(req.body);
    // The amount and advance are checked together, so re-check against the saved values.
    const amount = input.amountPaise ?? booking.amountPaise;
    const advance = input.advancePaise ?? booking.advancePaise;
    if (amount !== null && advance !== null && advance > amount) {
      throw errors.badRequest('ADVANCE_TOO_HIGH', 'The advance cannot be more than the amount');
    }
    const [updated] = await db
      .update(offlineBookings)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(offlineBookings.id, booking.id))
      .returning();
    const changed = Object.keys(input);
    await audit.record(
      {
        action: 'offline_booking.updated',
        entityType: 'offline_booking',
        entityId: booking.id,
        actorId: me.userId,
        actorRole: me.role,
        after: { changed },
      },
      auditContext(req),
    );
    const [item] = await withSlots([updated ?? booking]);
    res.json(item);
  });

  r.post('/offline-bookings/:id/cancel', requirePermission('calendar:manage'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    const booking = await scoped.offlineBooking(scope, req.params['id']);
    if (booking.status === 'CANCELLED') {
      const [item] = await withSlots([booking]);
      res.json(item); // already cancelled: nothing to do
      return;
    }
    const freed = await db.transaction(async (tx) => {
      const blocks = await tx
        .delete(availabilityBlocks)
        .where(eq(availabilityBlocks.offlineBookingId, booking.id))
        .returning({ eventDate: availabilityBlocks.eventDate, slot: availabilityBlocks.slot });
      await tx
        .update(offlineBookings)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(offlineBookings.id, booking.id));
      return blocks;
    });
    await audit.record(
      {
        action: 'offline_booking.cancelled',
        entityType: 'offline_booking',
        entityId: booking.id,
        actorId: me.userId,
        actorRole: me.role,
        before: { slots: freed },
      },
      auditContext(req),
    );
    const [item] = await withSlots([{ ...booking, status: 'CANCELLED', cancelledAt: new Date() }]);
    res.json(item);
  });

  return r;
}
