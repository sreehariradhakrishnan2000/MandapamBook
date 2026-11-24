import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  auditoriums,
  availabilityBlocks,
  bookings,
  cities,
  halls,
  offlineBookings,
  ownerStaff,
  reviews,
  users,
} from '../../../src/db/schema/index.js';
import { bookingValues, hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

describe.skipIf(!hasTestDb)('reviews', { timeout: 120_000 }, () => {
  let h: Harness;
  let venueId: string;
  let hallId: string;
  let ownerClient: Client;
  let day = 0;
  /** Distinct past dates, so each completed booking has its own hall-date. */
  const pastDate = () =>
    new Date(Date.UTC(2025, 0, 1) + day++ * 86_400_000).toISOString().slice(0, 10);

  /** A unique, valid Indian mobile number. */
  const randomPhone = () => `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  async function login(
    role: 'CUSTOMER' | 'OWNER' | 'ADMIN' | 'OWNER_STAFF',
    fullName?: string,
    extra: { phone?: string | null } = {},
  ) {
    // Reviewers need a phone number on their account; customers get one unless a test says not.
    const phone = 'phone' in extra ? extra.phone : role === 'CUSTOMER' ? randomPhone() : null;
    const u = await createUser(h.db, role, { ...(fullName ? { fullName } : {}), phone });
    const c = new Client(h.app);
    await c.login(u.email);
    return { ...u, c };
  }

  async function booking(customerId: string, status: 'COMPLETED' | 'CONFIRMED' = 'COMPLETED') {
    const [b] = await h.db
      .insert(bookings)
      .values(
        bookingValues({ customerId, auditoriumId: venueId, hallId } as never, {
          date: pastDate(),
          slot: 'FULL_DAY',
          status,
        }),
      )
      .returning();
    return b!.id;
  }

  const rating = async () =>
    (await h.db.select().from(auditoriums).where(eq(auditoriums.id, venueId)))[0]!;

  beforeAll(async () => {
    h = await createHarness();
    const [city] = await h.db
      .insert(cities)
      .values({
        name: 'Madurai',
        slug: `madurai-${randomBytes(3).toString('hex')}`,
        district: 'Madurai',
        state: 'Tamil Nadu',
      })
      .returning();
    const owner = await login('OWNER');
    ownerClient = owner.c;
    const [a] = await h.db
      .insert(auditoriums)
      .values({
        ownerId: owner.id,
        cityId: city!.id,
        name: 'Meenakshi Kalyana Mandapam',
        slug: `meenakshi-${randomBytes(4).toString('hex')}`,
        addressLine: 'West Masi Street',
        pincode: '625001',
        cateringPolicy: 'IN_HOUSE_ONLY',
        decorationPolicy: 'OUTSIDE_ALLOWED',
        advancePercent: 20,
        status: 'APPROVED',
      })
      .returning();
    venueId = a!.id;
    const [hall] = await h.db
      .insert(halls)
      .values({ auditoriumId: venueId, name: 'Main', seatingCapacity: 800 })
      .returning();
    hallId = hall!.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('lets a customer review a completed booking once and updates the venue rating', async () => {
    const cust = await login('CUSTOMER', 'Lakshmi Sundaram');
    const id = await booking(cust.id);
    const res = await cust.c.send('post', `/api/v1/bookings/${id}/review`, {
      rating: 4,
      body: '  Spacious hall, helpful staff.\u0007  ',
    });
    expect(res.status).toBe(201);
    expect((await rating()).ratingCount).toBe(1);
    expect(Number((await rating()).ratingAvg)).toBe(4);
    const [stored] = await h.db.select().from(reviews).where(eq(reviews.id, res.body.id));
    expect(stored!.body).toBe('Spacious hall, helpful staff.');

    const again = await cust.c.send('post', `/api/v1/bookings/${id}/review`, { rating: 5 });
    expect(again.body.error.code).toBe('ALREADY_REVIEWED');

    const second = await login('CUSTOMER');
    await second.c.send('post', `/api/v1/bookings/${await booking(second.id)}/review`, {
      rating: 5,
    });
    expect(Number((await rating()).ratingAvg)).toBe(4.5);

    const list = await new Client(h.app).send('get', `/api/v1/auditoriums/${venueId}/reviews`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ ratingAvg: 4.5, ratingCount: 2 });
    const mine = list.body.items.find((i: { id: string }) => i.id === res.body.id);
    expect(mine.author).toBe('Lakshmi S.');
    expect(JSON.stringify(list.body)).not.toContain('Sundaram');
  });

  it('refuses reviews of other customers, unfinished bookings and bad input', async () => {
    const cust = await login('CUSTOMER');
    const other = await login('CUSTOMER');
    const id = await booking(cust.id);
    expect(
      (await other.c.send('post', `/api/v1/bookings/${id}/review`, { rating: 5 })).status,
    ).toBe(404);
    const upcoming = await booking(cust.id, 'CONFIRMED');
    expect(
      (await cust.c.send('post', `/api/v1/bookings/${upcoming}/review`, { rating: 5 })).body.error
        .code,
    ).toBe('NOT_REVIEWABLE');
    expect((await cust.c.send('post', `/api/v1/bookings/${id}/review`, { rating: 6 })).status).toBe(
      400,
    );
    expect(
      (
        await cust.c.send('post', `/api/v1/bookings/${id}/review`, {
          rating: 3,
          body: 'x'.repeat(2001),
        })
      ).status,
    ).toBe(400);
    expect(
      (await cust.c.send('post', `/api/v1/bookings/${id}/review`, { rating: 3, extra: 1 })).status,
    ).toBe(400);
    expect(
      (await ownerClient.send('post', `/api/v1/bookings/${id}/review`, { rating: 5 })).status,
    ).toBe(403);
  });

  it('lets the owner reply, but not staff or other owners', async () => {
    const cust = await login('CUSTOMER');
    const created = await cust.c.send('post', `/api/v1/bookings/${await booking(cust.id)}/review`, {
      rating: 2,
      body: 'AC was not working',
    });
    const id = created.body.id as string;

    const inbox = await ownerClient.send('get', '/api/v1/owner/reviews');
    expect(inbox.body.items.some((i: { id: string }) => i.id === id)).toBe(true);
    const reply = await ownerClient.send('post', `/api/v1/owner/reviews/${id}/reply`, {
      reply: 'Sorry, it is fixed now.',
    });
    expect(reply.status).toBe(200);

    const stranger = await login('OWNER');
    expect((await stranger.c.send('get', '/api/v1/owner/reviews')).body.items).toEqual([]);
    expect(
      (await stranger.c.send('post', `/api/v1/owner/reviews/${id}/reply`, { reply: 'hijack' }))
        .status,
    ).toBe(404);

    const [venue] = await h.db.select().from(auditoriums).where(eq(auditoriums.id, venueId));
    const staff = await login('OWNER_STAFF');
    await h.db.insert(ownerStaff).values({ ownerId: venue!.ownerId, userId: staff.id });
    expect((await staff.c.send('get', '/api/v1/owner/reviews')).status).toBe(200);
    expect(
      (await staff.c.send('post', `/api/v1/owner/reviews/${id}/reply`, { reply: 'staff reply' }))
        .status,
    ).toBe(403);

    const [stored] = await h.db.select().from(reviews).where(eq(reviews.id, id));
    expect(stored!.ownerReply).toBe('Sorry, it is fixed now.');
  });

  it('lets admins hide and restore reviews, with the rating and audit log following', async () => {
    const cust = await login('CUSTOMER');
    const created = await cust.c.send('post', `/api/v1/bookings/${await booking(cust.id)}/review`, {
      rating: 1,
      body: 'spam spam',
    });
    const id = created.body.id as string;
    const countBefore = (await rating()).ratingCount;

    const admin = await login('ADMIN');
    expect(
      (
        await cust.c.send('patch', `/api/v1/admin/reviews/${id}`, {
          status: 'HIDDEN',
          reason: 'spam',
        })
      ).status,
    ).toBe(403);
    expect(
      (await admin.c.send('patch', `/api/v1/admin/reviews/${id}`, { status: 'HIDDEN' })).status,
    ).toBe(400);
    const hide = await admin.c.send('patch', `/api/v1/admin/reviews/${id}`, {
      status: 'HIDDEN',
      reason: 'Spam content',
    });
    expect(hide.body).toEqual({ id, status: 'HIDDEN' });
    expect((await rating()).ratingCount).toBe(countBefore - 1);
    const pub = await new Client(h.app).send(
      'get',
      `/api/v1/auditoriums/${venueId}/reviews?limit=50`,
    );
    expect(pub.body.items.some((i: { id: string }) => i.id === id)).toBe(false);

    const list = await admin.c.send('get', '/api/v1/admin/reviews?status=HIDDEN');
    expect(list.body.items.some((i: { id: string }) => i.id === id)).toBe(true);
    await admin.c.send('patch', `/api/v1/admin/reviews/${id}`, {
      status: 'PUBLISHED',
      reason: 'Appeal accepted',
    });
    expect((await rating()).ratingCount).toBe(countBefore);

    const logs = await h.db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(logs.map((l) => l.action)).toEqual(['review.moderated', 'review.moderated']);
  });

  it('rate-limits review writes per user', async () => {
    const cust = await login('CUSTOMER');
    const id = await booking(cust.id, 'CONFIRMED');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await cust.c.send('post', `/api/v1/bookings/${id}/review`, { rating: 5 })).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('returns 404 for reviews of unknown or unapproved venues', async () => {
    const c = new Client(h.app);
    expect(
      (await c.send('get', '/api/v1/auditoriums/00000000-0000-4000-8000-000000000000/reviews'))
        .status,
    ).toBe(404);
    expect((await c.send('get', '/api/v1/auditoriums/not-a-uuid/reviews')).status).toBe(404);
  });

  it("needs a phone number on the account, and keeps the reviewer's details", async () => {
    const noPhone = await login('CUSTOMER', 'Meera Pillai', { phone: null });
    const refused = await noPhone.c.send(
      'post',
      `/api/v1/bookings/${await booking(noPhone.id)}/review`,
      { rating: 5 },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PHONE_REQUIRED');

    const cust = await login('CUSTOMER', 'Anu Varghese');
    const ok = await cust.c.send('post', `/api/v1/bookings/${await booking(cust.id)}/review`, {
      rating: 5,
    });
    expect(ok.status).toBe(201);
    const [stored] = await h.db.select().from(reviews).where(eq(reviews.id, ok.body.id));
    const [account] = await h.db.select().from(users).where(eq(users.id, cust.id));
    expect(stored).toMatchObject({
      reviewerName: 'Anu Varghese',
      reviewerEmail: cust.email,
      reviewerPhone: account!.phone,
    });

    // Changing the account later doesn't rewrite who wrote the review.
    await h.db.update(users).set({ fullName: 'Someone Else' }).where(eq(users.id, cust.id));
    const admin = await login('ADMIN');
    const list = await admin.c.send('get', '/api/v1/admin/reviews?limit=50');
    expect(list.body.items.find((i: { id: string }) => i.id === ok.body.id)).toMatchObject({
      customerName: 'Anu Varghese',
      customerEmail: cust.email,
      customerPhone: account!.phone,
      source: 'APP',
    });
  });

  describe('guests of bookings taken offline', () => {
    async function offlineBooking(phone: string, dates: string[], status = 'ACTIVE') {
      const [ob] = await h.db
        .insert(offlineBookings)
        .values({
          auditoriumId: venueId,
          hallId,
          customerName: 'Guest',
          customerPhone: phone,
          status,
        })
        .returning();
      for (const eventDate of dates) {
        await h.db
          .insert(availabilityBlocks)
          .values({ hallId, eventDate, slot: 'FULL_DAY', offlineBookingId: ob!.id });
      }
      return ob!.id;
    }
    const futureDate = () =>
      new Date(Date.now() + (200 + day++) * 86_400_000).toISOString().slice(0, 10);
    const review = (c: Client, id: string, body: object) =>
      c.send('post', `/api/v1/offline-bookings/${id}/review`, body);

    it('can review once the event is over, only from a verified number that matches', async () => {
      const phone = randomPhone();
      const [d1, d2] = [pastDate(), pastDate()];
      const id = await offlineBooking(phone, [d1, d2]);
      const guest = await login('CUSTOMER', 'Deepa Menon', { phone });

      // The number is on the account but not verified: nothing is unlocked.
      expect((await guest.c.send('get', '/api/v1/me/offline-bookings')).body.items).toEqual([]);
      expect((await review(guest.c, id, { rating: 5 })).status).toBe(404);

      await h.db.update(users).set({ phoneVerifiedAt: new Date() }).where(eq(users.id, guest.id));
      const mine = await guest.c.send('get', '/api/v1/me/offline-bookings');
      expect(mine.body.items).toEqual([
        expect.objectContaining({
          offlineBookingId: id,
          venueName: 'Meenakshi Kalyana Mandapam',
          firstDate: d1,
          lastDate: d2,
          canReview: true,
          review: null,
        }),
      ]);

      const before = (await rating()).ratingCount;
      const posted = await review(guest.c, id, { rating: 4, body: 'Lovely sadya kitchen.' });
      expect(posted.status).toBe(201);
      expect((await rating()).ratingCount).toBe(before + 1);
      const [stored] = await h.db.select().from(reviews).where(eq(reviews.id, posted.body.id));
      expect(stored).toMatchObject({
        offlineBookingId: id,
        bookingId: null,
        eventDate: d1,
        reviewerName: 'Deepa Menon',
        reviewerPhone: phone,
      });
      expect((await review(guest.c, id, { rating: 5 })).body.error.code).toBe('ALREADY_REVIEWED');
      const after = await guest.c.send('get', '/api/v1/me/offline-bookings');
      expect(after.body.items[0]).toMatchObject({ canReview: false, review: { rating: 4 } });

      const pub = await new Client(h.app).send(
        'get',
        `/api/v1/auditoriums/${venueId}/reviews?limit=50`,
      );
      expect(pub.body.items.find((i: { id: string }) => i.id === posted.body.id).author).toBe(
        'Deepa M.',
      );
      expect(JSON.stringify(pub.body)).not.toContain(phone);
    });

    it('refuses before the last date, other people, and cancelled bookings', async () => {
      const phone = randomPhone();
      const guest = await login('CUSTOMER', 'Joseph Mathew', { phone });
      await h.db.update(users).set({ phoneVerifiedAt: new Date() }).where(eq(users.id, guest.id));

      // A two-day booking whose second day is still ahead.
      const upcoming = await offlineBooking(phone, [pastDate(), futureDate()]);
      expect((await review(guest.c, upcoming, { rating: 5 })).body.error.code).toBe(
        'NOT_REVIEWABLE',
      );
      const listed = await guest.c.send('get', '/api/v1/me/offline-bookings');
      expect(
        listed.body.items.find(
          (i: { offlineBookingId: string }) => i.offlineBookingId === upcoming,
        ),
      ).toMatchObject({ canReview: false });

      const someoneElses = await offlineBooking(randomPhone(), [pastDate()]);
      expect((await review(guest.c, someoneElses, { rating: 1 })).status).toBe(404);

      const cancelled = await offlineBooking(phone, [pastDate()], 'CANCELLED');
      expect((await review(guest.c, cancelled, { rating: 1 })).status).toBe(404);
    });
  });
});
