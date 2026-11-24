import { Router, type RequestHandler } from 'express';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  type PublicReview,
  type ReviewableOfflineBooking,
  adminReviewQuerySchema,
  createReviewSchema,
  moderateReviewSchema,
  reviewListQuerySchema,
  reviewReplySchema,
  reviewerDisplayName,
} from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import { PG_ERROR, pgErrorCode } from '../../db/client.js';
import {
  auditoriums,
  availabilityBlocks,
  bookings,
  halls,
  offlineBookings,
  reviews,
  users,
} from '../../db/schema/index.js';
import { todayInIst } from '../../lib/time.js';
import { errors } from '../../http/errors.js';
import type { RateLimiters } from '../../http/middleware/rate-limit.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { auditoriumScopeCondition } from '../rbac/owner-scope.js';
import { type ScopedResources, parseId, requireOwner } from '../owners/scoped.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Keeps the venue's average and count in step with its published reviews. */
export async function refreshRating(tx: Tx, auditoriumId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE auditoriums a SET
      rating_avg = s.avg,
      rating_count = s.n
    FROM (
      SELECT ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*)::int AS n
      FROM reviews WHERE auditorium_id = ${auditoriumId} AND status = 'PUBLISHED'
    ) s
    WHERE a.id = ${auditoriumId}`);
}

const monthOf = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Reviews. Only a customer whose booking was completed can review it, once. Public
 * listings show first name and initial only. Owners reply; admins hide or restore.
 */
export function reviewsRouter(deps: {
  db: Db;
  authenticate: RequestHandler;
  scoped: ScopedResources;
  audit: AuditService;
  limiters: RateLimiters;
}): Router {
  const { db, authenticate, scoped, audit, limiters } = deps;
  const r = Router();

  /**
   * Only people whose account has a name, an email and a mobile number may review. Their
   * details are copied onto the review, so it stays traceable if the account changes.
   */
  async function reviewerFor(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw errors.unauthenticated();
    if (!user.phone) {
      throw errors.conflict(
        'PHONE_REQUIRED',
        'Add your mobile number in your account before writing a review',
      );
    }
    return {
      reviewerName: user.fullName,
      reviewerEmail: user.email,
      reviewerPhone: user.phone,
      user,
    };
  }

  /**
   * Bookings venues took offline for this person, matched on their VERIFIED mobile number:
   * an unverified number could be anyone's, so it never unlocks someone else's booking.
   */
  async function offlineBookingsFor(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.phone || !user.phoneVerifiedAt) return [];
    const firstDate = sql<string>`min(${availabilityBlocks.eventDate})`;
    const lastDate = sql<string>`max(${availabilityBlocks.eventDate})`;
    return db
      .select({
        id: offlineBookings.id,
        auditoriumId: offlineBookings.auditoriumId,
        venueName: auditoriums.name,
        venueSlug: auditoriums.slug,
        hallName: halls.name,
        eventType: offlineBookings.eventType,
        firstDate,
        lastDate,
      })
      .from(offlineBookings)
      .innerJoin(auditoriums, eq(auditoriums.id, offlineBookings.auditoriumId))
      .innerJoin(halls, eq(halls.id, offlineBookings.hallId))
      .innerJoin(availabilityBlocks, eq(availabilityBlocks.offlineBookingId, offlineBookings.id))
      .where(
        and(
          eq(offlineBookings.customerPhone, user.phone),
          eq(offlineBookings.status, 'ACTIVE'),
          eq(auditoriums.status, 'APPROVED'),
        ),
      )
      .groupBy(offlineBookings.id, auditoriums.id, halls.id)
      .orderBy(desc(lastDate));
  }

  /** Events venues booked for me outside the app, and whether I can review them yet. */
  r.get(
    '/me/offline-bookings',
    authenticate,
    requirePermission('review:create'),
    async (req, res) => {
      const me = currentUser(req);
      const rows = await offlineBookingsFor(me.userId);
      const existing = rows.length
        ? await db
            .select()
            .from(reviews)
            .where(
              and(
                eq(reviews.customerId, me.userId),
                inArray(
                  reviews.offlineBookingId,
                  rows.map((x) => x.id),
                ),
              ),
            )
        : [];
      const today = todayInIst();
      const items: ReviewableOfflineBooking[] = rows.map((x) => {
        const review = existing.find((rv) => rv.offlineBookingId === x.id);
        return {
          offlineBookingId: x.id,
          venueName: x.venueName,
          venueSlug: x.venueSlug,
          hallName: x.hallName,
          eventType: x.eventType,
          firstDate: x.firstDate,
          lastDate: x.lastDate,
          canReview: !review && x.lastDate < today,
          review: review
            ? { id: review.id, rating: review.rating, body: review.body, status: review.status }
            : null,
        };
      });
      res.set('Cache-Control', 'no-store').json({ items });
    },
  );

  r.post(
    '/offline-bookings/:id/review',
    authenticate,
    requirePermission('review:create'),
    async (req, res) => {
      const me = currentUser(req);
      await limiters.consume('reviewWritePerUser', me.userId);
      const id = parseId(req.params['id']);
      const input = createReviewSchema.parse(req.body);
      const reviewer = await reviewerFor(me.userId);
      // Not matching your verified number looks exactly like not existing.
      const booking = (await offlineBookingsFor(me.userId)).find((x) => x.id === id);
      if (!booking) throw errors.notFound('Booking not found');
      if (booking.lastDate >= todayInIst()) {
        throw errors.conflict('NOT_REVIEWABLE', 'You can review a booking after the event');
      }
      try {
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(reviews)
            .values({
              offlineBookingId: booking.id,
              customerId: me.userId,
              auditoriumId: booking.auditoriumId,
              rating: input.rating,
              body: input.body,
              eventDate: booking.firstDate,
              reviewerName: reviewer.reviewerName,
              reviewerEmail: reviewer.reviewerEmail,
              reviewerPhone: reviewer.reviewerPhone,
            })
            .returning();
          await refreshRating(tx, booking.auditoriumId);
          if (!row) throw new Error('review insert returned no row');
          return row;
        });
        res.status(201).json({ id: created.id, rating: created.rating, status: created.status });
      } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
          throw errors.conflict('ALREADY_REVIEWED', 'This booking has already been reviewed');
        }
        throw err;
      }
    },
  );

  r.get('/auditoriums/:id/reviews', async (req, res) => {
    const id = parseId(req.params['id']);
    const q = reviewListQuerySchema.parse(req.query);
    const [venue] = await db
      .select({ ratingAvg: auditoriums.ratingAvg, ratingCount: auditoriums.ratingCount })
      .from(auditoriums)
      .where(and(eq(auditoriums.id, id), eq(auditoriums.status, 'APPROVED')));
    if (!venue) throw errors.notFound();
    const rows = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.auditoriumId, id), eq(reviews.status, 'PUBLISHED')))
      .orderBy(desc(reviews.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    const items: PublicReview[] = rows.map((rv) => ({
      id: rv.id,
      rating: rv.rating,
      body: rv.body,
      author: reviewerDisplayName(rv.reviewerName),
      eventMonth: monthOf(rv.eventDate),
      createdAt: rv.createdAt.toISOString(),
      ownerReply: rv.ownerReply,
    }));
    res.set('Cache-Control', 'public, max-age=60').json({
      ratingAvg: venue.ratingAvg === null ? null : Number(venue.ratingAvg),
      ratingCount: venue.ratingCount,
      items,
    });
  });

  r.post(
    '/bookings/:id/review',
    authenticate,
    requirePermission('review:create'),
    async (req, res) => {
      const me = currentUser(req);
      await limiters.consume('reviewWritePerUser', me.userId);
      const id = parseId(req.params['id']);
      const input = createReviewSchema.parse(req.body);
      const reviewer = await reviewerFor(me.userId);
      try {
        const created = await db.transaction(async (tx) => {
          const [b] = await tx
            .select()
            .from(bookings)
            .where(and(eq(bookings.id, id), eq(bookings.customerId, me.userId)));
          if (!b) throw errors.notFound('Booking not found');
          if (b.status !== 'COMPLETED') {
            throw errors.conflict('NOT_REVIEWABLE', 'You can review a booking after the event');
          }
          const [row] = await tx
            .insert(reviews)
            .values({
              bookingId: b.id,
              customerId: me.userId,
              auditoriumId: b.auditoriumId,
              rating: input.rating,
              body: input.body,
              eventDate: b.eventDate,
              reviewerName: reviewer.reviewerName,
              reviewerEmail: reviewer.reviewerEmail,
              reviewerPhone: reviewer.reviewerPhone,
            })
            .returning();
          await refreshRating(tx, b.auditoriumId);
          if (!row) throw new Error('review insert returned no row');
          return row;
        });
        res.status(201).json({ id: created.id, rating: created.rating, status: created.status });
      } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
          throw errors.conflict('ALREADY_REVIEWED', 'You have already reviewed this booking');
        }
        throw err;
      }
    },
  );

  r.get(
    '/owner/reviews',
    authenticate,
    requirePermission('booking:view_venue'),
    async (req, res) => {
      const scope = await scoped.scope(req);
      const q = reviewListQuerySchema.parse(req.query);
      const rows = await db
        .select({ r: reviews, venueName: auditoriums.name })
        .from(reviews)
        .innerJoin(auditoriums, eq(auditoriums.id, reviews.auditoriumId))
        .where(auditoriumScopeCondition(scope))
        .orderBy(desc(reviews.createdAt))
        .limit(q.limit)
        .offset(q.offset);
      res.set('Cache-Control', 'no-store').json({
        items: rows.map(({ r: rv, venueName }) => ({
          id: rv.id,
          venueName,
          rating: rv.rating,
          body: rv.body,
          author: reviewerDisplayName(rv.reviewerName),
          source: rv.offlineBookingId ? 'OFFLINE' : 'APP',
          status: rv.status,
          ownerReply: rv.ownerReply,
          createdAt: rv.createdAt.toISOString(),
        })),
      });
    },
  );

  r.post(
    '/owner/reviews/:id/reply',
    authenticate,
    requirePermission('review:reply'),
    async (req, res) => {
      const me = currentUser(req);
      await limiters.consume('reviewWritePerUser', me.userId);
      const scope = await scoped.scope(req);
      requireOwner(scope);
      const id = parseId(req.params['id']);
      const { reply } = reviewReplySchema.parse(req.body);
      const [row] = await db
        .select({ r: reviews })
        .from(reviews)
        .innerJoin(auditoriums, eq(auditoriums.id, reviews.auditoriumId))
        .where(and(eq(reviews.id, id), auditoriumScopeCondition(scope)));
      if (!row) throw errors.notFound('Review not found');
      await db.transaction(async (tx) => {
        await tx.update(reviews).set({ ownerReply: reply }).where(eq(reviews.id, id));
        await audit.record(
          {
            action: 'review.replied',
            entityType: 'review',
            entityId: id,
            actorId: me.userId,
            actorRole: me.role,
            before: { ownerReply: row.r.ownerReply },
            after: { ownerReply: reply },
          },
          auditContext(req),
          tx,
        );
      });
      res.json({ id, ownerReply: reply });
    },
  );

  r.get('/admin/reviews', authenticate, requirePermission('review:moderate'), async (req, res) => {
    const q = adminReviewQuerySchema.parse(req.query);
    const where = q.status ? eq(reviews.status, q.status) : undefined;
    const [rows, [total]] = await Promise.all([
      db
        .select({ r: reviews, venueName: auditoriums.name })
        .from(reviews)
        .innerJoin(auditoriums, eq(auditoriums.id, reviews.auditoriumId))
        .where(where)
        .orderBy(desc(reviews.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      db.select({ n: count() }).from(reviews).where(where),
    ]);
    res.set('Cache-Control', 'no-store').json({
      total: total?.n ?? 0,
      // Admins moderating reviews see who wrote each one, as their account said at the time.
      items: rows.map(({ r: rv, venueName }) => ({
        id: rv.id,
        venueName,
        customerName: rv.reviewerName,
        customerEmail: rv.reviewerEmail,
        customerPhone: rv.reviewerPhone,
        source: rv.offlineBookingId ? 'OFFLINE' : 'APP',
        eventDate: rv.eventDate,
        rating: rv.rating,
        body: rv.body,
        status: rv.status,
        ownerReply: rv.ownerReply,
        createdAt: rv.createdAt.toISOString(),
      })),
    });
  });

  r.patch(
    '/admin/reviews/:id',
    authenticate,
    requirePermission('review:moderate'),
    async (req, res) => {
      const me = currentUser(req);
      const id = parseId(req.params['id']);
      const { status, reason } = moderateReviewSchema.parse(req.body);
      const updated = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(reviews).where(eq(reviews.id, id)).for('update');
        if (!before) throw errors.notFound('Review not found');
        const [row] = await tx
          .update(reviews)
          .set({ status })
          .where(eq(reviews.id, id))
          .returning();
        await refreshRating(tx, before.auditoriumId);
        await audit.record(
          {
            action: 'review.moderated',
            entityType: 'review',
            entityId: id,
            actorId: me.userId,
            actorRole: me.role,
            before: { status: before.status },
            after: { status, reason },
          },
          auditContext(req),
          tx,
        );
        if (!row) throw errors.notFound('Review not found');
        return row;
      });
      res.json({ id: updated.id, status: updated.status });
    },
  );

  return r;
}
