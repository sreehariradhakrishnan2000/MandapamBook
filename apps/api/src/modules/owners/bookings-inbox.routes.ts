import { Router } from 'express';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { ownerBookingQuerySchema } from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import { auditoriums, bookings, cities, halls, users } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import type { PaymentService } from '../payments/payment.service.js';
import { bookingSummary } from '../bookings/bookings.routes.js';
import { StaleBookingError, transition } from '../bookings/state-machine.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { auditoriumScopeCondition } from '../rbac/owner-scope.js';
import { type ScopedResources, parseId, requireOwner } from './scoped.js';

/**
 * Owner booking inbox. Customer contact details appear only for bookings that are paid
 * (AWAITING_OWNER onwards); unpaid holds show no personal data.
 */
export function bookingsInboxRouter(deps: {
  db: Db;
  scoped: ScopedResources;
  audit: AuditService;
  payments: PaymentService;
}): Router {
  const { db, scoped, audit, payments } = deps;
  const r = Router();
  const PAID = ['AWAITING_OWNER', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as const;

  r.get('/bookings', requirePermission('booking:view_venue'), async (req, res) => {
    const scope = await scoped.scope(req);
    const q = ownerBookingQuerySchema.parse(req.query);
    const rows = await db
      .select({
        ...bookingSummary,
        customerName: users.fullName,
        customerPhone: users.phone,
        customerEmail: users.email,
      })
      .from(bookings)
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .innerJoin(halls, eq(halls.id, bookings.hallId))
      .innerJoin(cities, eq(cities.id, auditoriums.cityId))
      .innerJoin(users, eq(users.id, bookings.customerId))
      .where(
        and(
          auditoriumScopeCondition(scope),
          q.status ? eq(bookings.status, q.status) : undefined,
          q.from ? gte(bookings.eventDate, q.from) : undefined,
          q.to ? lte(bookings.eventDate, q.to) : undefined,
        ),
      )
      .orderBy(desc(bookings.eventDate))
      .limit(q.limit)
      .offset(q.offset);
    res.set('Cache-Control', 'no-store').json({
      items: rows.map(({ customerName, customerPhone, customerEmail, ...b }) =>
        (PAID as readonly string[]).includes(b.status)
          ? { ...b, customer: { name: customerName, phone: customerPhone, email: customerEmail } }
          : { ...b, customer: null },
      ),
    });
  });

  const loadScoped = async (req: Parameters<typeof scoped.scope>[0]) => {
    const scope = await scoped.scope(req);
    const id = parseId(req.params['id']);
    const [row] = await db
      .select({ b: bookings })
      .from(bookings)
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .where(and(eq(bookings.id, id), auditoriumScopeCondition(scope)));
    if (!row) throw errors.notFound('Booking not found');
    return { scope, booking: row.b };
  };

  /** Request-mode venues: the owner confirms a paid booking. */
  r.post('/bookings/:id/accept', requirePermission('booking:approve'), async (req, res) => {
    const me = currentUser(req);
    const { scope, booking } = await loadScoped(req);
    requireOwner(scope);
    if (booking.status !== 'AWAITING_OWNER') {
      throw errors.conflict(
        'INVALID_TRANSITION',
        'Only bookings waiting for your approval can be accepted',
      );
    }
    try {
      const updated = await db.transaction(async (tx) => {
        const row = await transition(tx, {
          bookingId: booking.id,
          from: 'AWAITING_OWNER',
          to: 'CONFIRMED',
          version: booking.version,
          actorId: me.userId,
          reason: 'accepted_by_owner',
        });
        await audit.record(
          {
            action: 'booking.accepted',
            entityType: 'booking',
            entityId: booking.id,
            actorId: me.userId,
            actorRole: me.role,
            before: { status: 'AWAITING_OWNER' },
            after: { status: 'CONFIRMED' },
          },
          auditContext(req),
          tx,
        );
        return row;
      });
      res.json({ id: updated.id, status: updated.status });
    } catch (err) {
      if (err instanceof StaleBookingError)
        throw errors.conflict(
          'BOOKING_CHANGED',
          'This booking just changed. Reload and try again.',
        );
      throw err;
    }
  });

  /** Declines a paid request: the booking is cancelled and everything paid online is refunded. */
  r.post('/bookings/:id/reject', requirePermission('booking:approve'), async (req, res) => {
    const me = currentUser(req);
    const { scope, booking } = await loadScoped(req);
    requireOwner(scope);
    const refund = await payments.cancelAwaitingOwner(
      booking.id,
      'rejected_by_owner',
      me.userId,
      auditContext(req),
    );
    const [after] = await db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    res.json({
      id: booking.id,
      status: after?.status,
      refundStatus: refund.status,
      refundPaise: refund.amountPaise,
    });
  });

  /** Records that the balance was paid at the venue. */
  r.post(
    '/bookings/:id/balance-received',
    requirePermission('booking:approve'),
    async (req, res) => {
      const me = currentUser(req);
      const { scope, booking } = await loadScoped(req);
      requireOwner(scope);
      if (!['CONFIRMED', 'COMPLETED'].includes(booking.status)) {
        throw errors.conflict(
          'INVALID_STATE',
          'Only confirmed bookings can be marked as fully paid',
        );
      }
      if (booking.balanceReceivedAt) {
        res.json({ id: booking.id, balanceReceivedAt: booking.balanceReceivedAt });
        return;
      }
      const [updated] = await db
        .update(bookings)
        .set({ balanceReceivedAt: new Date() })
        .where(
          and(eq(bookings.id, booking.id), inArray(bookings.status, ['CONFIRMED', 'COMPLETED'])),
        )
        .returning({ id: bookings.id, balanceReceivedAt: bookings.balanceReceivedAt });
      await audit.record(
        {
          action: 'booking.balance_received',
          entityType: 'booking',
          entityId: booking.id,
          actorId: me.userId,
          actorRole: me.role,
          after: { balancePaise: booking.totalPaise - booking.advancePaise },
        },
        auditContext(req),
      );
      res.json(updated);
    },
  );

  return r;
}
