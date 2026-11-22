import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  auditoriums,
  bookings,
  cities,
  halls,
  ownerStaff,
  reviews,
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

  async function login(role: 'CUSTOMER' | 'OWNER' | 'ADMIN' | 'OWNER_STAFF', fullName?: string) {
    const u = await createUser(h.db, role, fullName ? { fullName } : {});
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
});
