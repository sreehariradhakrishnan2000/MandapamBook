import { type RequestHandler, Router } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { cancelBookingSchema, quoteRequestSchema } from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import {
  auditoriums,
  bookingAddons,
  bookingStatusHistory,
  bookings,
  cities,
  halls,
  users,
} from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { type RateLimiters, byIp } from '../../http/middleware/rate-limit.js';
import { auditContext } from '../audit/audit.service.js';
import { parseId } from '../owners/scoped.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import type { PaymentService } from '../payments/payment.service.js';
import type { BookingService } from './booking.service.js';
import type { QuoteService } from './quote.service.js';

export const bookingSummary = {
  id: bookings.id,
  refCode: bookings.refCode,
  status: bookings.status,
  eventDate: bookings.eventDate,
  slot: bookings.slot,
  guestCount: bookings.guestCount,
  holdExpiresAt: bookings.holdExpiresAt,
  totalPaise: bookings.totalPaise,
  advancePaise: bookings.advancePaise,
  refundDuePaise: bookings.refundDuePaise,
  venueName: auditoriums.name,
  venueSlug: auditoriums.slug,
  hallName: halls.name,
  city: cities.name,
  createdAt: bookings.createdAt,
};

export function bookingsRouter(deps: {
  db: Db;
  quotes: QuoteService;
  bookings: BookingService;
  payments: PaymentService;
  limiters: RateLimiters;
  authenticate: RequestHandler;
}): Router {
  const { db, quotes, limiters, authenticate } = deps;
  const service = deps.bookings;
  const r = Router();

  /** Price for a slot. Public, so visitors can see the full breakdown before signing in. */
  r.post('/bookings/quote', limiters.middleware('quotePerIp', byIp), async (req, res) => {
    const { view } = await quotes.quote(quoteRequestSchema.parse(req.body));
    res.set('Cache-Control', 'no-store').json(view);
  });

  r.use('/bookings', authenticate);

  /** Holds the slot for the configured number of minutes while the customer pays. */
  r.post('/bookings', requirePermission('booking:create'), async (req, res) => {
    const me = currentUser(req);
    await limiters.consume('holdPerUser', me.userId);
    const [user] = await db
      .select({ verified: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, me.userId));
    if (!user?.verified)
      throw errors.forbidden('Verify your email before booking. Check your inbox for the link.');
    const input = quoteRequestSchema.parse(req.body);
    const { booking, quote } = await service.hold(me.userId, input, auditContext(req));
    res.status(201).json({
      id: booking.id,
      refCode: booking.refCode,
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt,
      quote,
    });
  });

  r.get('/bookings/mine', requirePermission('booking:create'), async (req, res) => {
    const me = currentUser(req);
    const items = await db
      .select(bookingSummary)
      .from(bookings)
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .innerJoin(halls, eq(halls.id, bookings.hallId))
      .innerJoin(cities, eq(cities.id, auditoriums.cityId))
      .where(eq(bookings.customerId, me.userId))
      .orderBy(desc(bookings.createdAt))
      .limit(100);
    res.set('Cache-Control', 'no-store').json({ items });
  });

  /** A customer's own booking. Anyone else's returns 404. */
  const loadOwn = async (customerId: string, rawId: unknown) => {
    const id = parseId(rawId);
    const [b] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, id), eq(bookings.customerId, customerId)));
    if (!b) throw errors.notFound('Booking not found');
    return b;
  };

  r.get('/bookings/:id', requirePermission('booking:create'), async (req, res) => {
    const me = currentUser(req);
    const b = await loadOwn(me.userId, req.params['id']);
    const [[summary], addonRows, history] = await Promise.all([
      db
        .select({
          ...bookingSummary,
          addressLine: auditoriums.addressLine,
          pincode: auditoriums.pincode,
        })
        .from(bookings)
        .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
        .innerJoin(halls, eq(halls.id, bookings.hallId))
        .innerJoin(cities, eq(cities.id, auditoriums.cityId))
        .where(eq(bookings.id, b.id)),
      db.select().from(bookingAddons).where(eq(bookingAddons.bookingId, b.id)),
      db
        .select({ toStatus: bookingStatusHistory.toStatus, at: bookingStatusHistory.createdAt })
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, b.id))
        .orderBy(asc(bookingStatusHistory.createdAt)),
    ]);
    res.set('Cache-Control', 'no-store').json({
      ...summary,
      subtotalPaise: b.subtotalPaise,
      addonsPaise: b.addonsPaise,
      gstPaise: b.gstPaise,
      platformFeePaise: b.platformFeePaise,
      cancellationTiers: b.priceSnapshot.cancellationTiers,
      addons: addonRows.map((a) => ({
        addonId: a.addonId,
        quantity: a.quantity,
        totalPaise: a.totalPaise,
      })),
      history,
    });
  });

  r.get(
    '/bookings/:id/cancel-preview',
    requirePermission('booking:cancel_own'),
    async (req, res) => {
      const me = currentUser(req);
      const b = await loadOwn(me.userId, req.params['id']);
      res.set('Cache-Control', 'no-store').json(await service.refundPreview(b));
    },
  );

  r.post('/bookings/:id/cancel', requirePermission('booking:cancel_own'), async (req, res) => {
    const me = currentUser(req);
    const id = parseId(req.params['id']);
    const { reason } = cancelBookingSchema.parse(req.body ?? {});
    const ctx = auditContext(req);
    const result = await service.cancel(me.userId, id, reason, ctx);
    // Refund what the policy allows; the booking moves to REFUNDED once it is paid out.
    const refund =
      result.refund.refundPaise > 0
        ? await deps.payments.refundBooking({
            bookingId: id,
            amountPaise: result.refund.refundPaise,
            purpose: 'customer_cancel',
            reason: reason ?? 'Cancelled by customer',
            actorId: me.userId,
            ctx,
          })
        : null;
    const [after] = await db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, id));
    res.json({
      id,
      status: after?.status ?? result.booking.status,
      refund: result.refund,
      refundStatus: refund?.status ?? 'NONE',
    });
  });

  return r;
}
