import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  auditoriums,
  availabilityBlocks,
  cities,
  halls,
  offlineBookings,
  pricingRules,
} from '../../../src/db/schema/index.js';
import { hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

/** A date `days` from today, as YYYY-MM-DD. */
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasTestDb)('offline bookings', { timeout: 120_000 }, () => {
  let h: Harness;
  let owner: Client;
  let venueId: string;
  let hallId: string;
  let day = 40;
  const nextDay = () => inDays((day += 3));

  beforeAll(async () => {
    h = await createHarness();
    const me = await createUser(h.db, 'OWNER');
    owner = new Client(h.app);
    await owner.login(me.email);
    const slug = `thrissur-${randomBytes(3).toString('hex')}`;
    const [city] = await h.db
      .insert(cities)
      .values({ name: 'Thrissur', slug, district: 'Thrissur', state: 'Kerala' })
      .returning();
    const [venue] = await h.db
      .insert(auditoriums)
      .values({
        ownerId: me.id,
        cityId: city!.id,
        name: 'Offline Test Mandapam',
        slug: `offline-test-${randomBytes(3).toString('hex')}`,
        addressLine: '1 Temple Road',
        pincode: '680101',
        cateringPolicy: 'OUTSIDE_ALLOWED',
        decorationPolicy: 'OUTSIDE_ALLOWED',
        status: 'APPROVED',
      })
      .returning();
    venueId = venue!.id;
    const [hall] = await h.db
      .insert(halls)
      .values({ auditoriumId: venueId, name: 'Main Hall', seatingCapacity: 500, isAc: true })
      .returning();
    hallId = hall!.id;
    await h.db.insert(pricingRules).values(
      (['MORNING', 'EVENING', 'FULL_DAY'] as const).map((slot) => ({
        hallId,
        slot,
        kind: 'BASE' as const,
        pricePaise: 5_000_000,
        priority: 0,
      })),
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  const base = () => ({
    hallId,
    customerName: 'Lakshmi Nair',
    customerPhone: '98470 12345',
    eventType: 'Wedding',
    amountPaise: 15_000_000,
    advancePaise: 5_000_000,
    notes: 'Paid advance in cash',
  });
  const create = (body: object) =>
    owner.send('post', `/api/v1/owner/auditoriums/${venueId}/offline-bookings`, body);

  it('holds every date of the booking, privately, so nobody can book them online', async () => {
    const [d1, d2] = [nextDay(), nextDay()];
    const res = await create({
      ...base(),
      slots: [
        { eventDate: d1, slot: 'EVENING' },
        { eventDate: d2, slot: 'MORNING' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      hallName: 'Main Hall',
      customerName: 'Lakshmi Nair',
      customerPhone: '+919847012345',
      status: 'ACTIVE',
      slots: [
        { eventDate: d1, slot: 'EVENING' },
        { eventDate: d2, slot: 'MORNING' },
      ],
    });

    const cal = await owner.send(
      'get',
      `/api/v1/owner/halls/${hallId}/calendar?from=${d1}&to=${d2}`,
    );
    expect(cal.body.items).toEqual([
      expect.objectContaining({
        eventDate: d1,
        slot: 'EVENING',
        kind: 'OFFLINE',
        customerName: 'Lakshmi Nair',
      }),
      expect.objectContaining({ eventDate: d2, slot: 'MORNING', kind: 'OFFLINE' }),
    ]);

    const pub = await new Client(h.app).send(
      'get',
      `/api/v1/auditoriums/${venueId}/availability?month=${d1.slice(0, 7)}`,
    );
    expect(pub.body.halls[0].taken[d1]).toEqual(['EVENING']);
    expect(JSON.stringify(pub.body)).not.toContain('Lakshmi');
    expect(JSON.stringify(pub.body)).not.toContain('98470');

    const guest = await createUser(h.db, 'CUSTOMER');
    const c = new Client(h.app);
    await c.login(guest.email);
    const online = await c.send('post', '/api/v1/bookings', {
      hallId,
      eventDate: d1,
      slot: 'FULL_DAY', // overlaps the evening
      guestCount: 100,
    });
    expect(online.status).toBe(409);
    expect(online.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('refuses a clash with nothing half-saved, naming the date', async () => {
    const [free, taken] = [nextDay(), nextDay()];
    await h.db.insert(availabilityBlocks).values({ hallId, eventDate: taken, slot: 'FULL_DAY' });
    const before = await h.db.select().from(offlineBookings);
    const res = await create({
      ...base(),
      slots: [
        { eventDate: free, slot: 'MORNING' },
        { eventDate: taken, slot: 'MORNING' },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(res.body.error.message).toContain(taken);
    expect(await h.db.select().from(offlineBookings)).toHaveLength(before.length);
    expect(
      await h.db
        .select()
        .from(availabilityBlocks)
        .where(and(eq(availabilityBlocks.hallId, hallId), eq(availabilityBlocks.eventDate, free))),
    ).toHaveLength(0);
  });

  it('checks the details', async () => {
    const slots = [{ eventDate: nextDay(), slot: 'MORNING' }];
    for (const bad of [
      { ...base(), slots, customerPhone: '12345' },
      { ...base(), slots, advancePaise: 20_000_000 }, // more than the amount
      { ...base(), slots: [{ eventDate: inDays(-1), slot: 'MORNING' }] },
      { ...base(), slots: [...slots, ...slots] },
      { ...base(), slots: [] },
    ]) {
      expect((await create(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('edits only the details sent, and cancels to free the dates while keeping the record', async () => {
    const d = nextDay();
    const created = (await create({ ...base(), slots: [{ eventDate: d, slot: 'FULL_DAY' }] })).body;

    const edited = await owner.send('patch', `/api/v1/owner/offline-bookings/${created.id}`, {
      notes: 'Balance due on the day',
    });
    expect(edited.body).toMatchObject({
      notes: 'Balance due on the day',
      customerName: 'Lakshmi Nair',
      amountPaise: 15_000_000,
      advancePaise: 5_000_000,
    });
    const tooMuch = await owner.send('patch', `/api/v1/owner/offline-bookings/${created.id}`, {
      advancePaise: 16_000_000,
    });
    expect(tooMuch.status).toBe(400);

    // A single date of the booking can't be unblocked on its own.
    const [block] = await h.db
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.offlineBookingId, created.id));
    const unblock = await owner.send('delete', `/api/v1/owner/blocks/${block!.id}`);
    expect(unblock.status).toBe(409);
    expect(unblock.body.error.code).toBe('PART_OF_OFFLINE_BOOKING');

    const cancelled = await owner.send(
      'post',
      `/api/v1/owner/offline-bookings/${created.id}/cancel`,
    );
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', slots: [] });
    expect(
      await h.db
        .select()
        .from(availabilityBlocks)
        .where(eq(availabilityBlocks.offlineBookingId, created.id)),
    ).toHaveLength(0);
    // The date is free again.
    expect((await create({ ...base(), slots: [{ eventDate: d, slot: 'FULL_DAY' }] })).status).toBe(
      201,
    );

    expect(
      (await owner.send('post', `/api/v1/owner/offline-bookings/${created.id}/cancel`)).status,
    ).toBe(200);
    expect(
      (await owner.send('patch', `/api/v1/owner/offline-bookings/${created.id}`, { notes: 'x' }))
        .status,
    ).toBe(409);

    const active = await owner.send('get', `/api/v1/owner/auditoriums/${venueId}/offline-bookings`);
    expect(active.body.items.map((b: { id: string }) => b.id)).not.toContain(created.id);
    const all = await owner.send(
      'get',
      `/api/v1/owner/auditoriums/${venueId}/offline-bookings?status=ALL`,
    );
    expect(all.body.items.map((b: { id: string }) => b.id)).toContain(created.id);
  });

  it('keeps other owners and customers out, and never logs the full phone number', async () => {
    const created = (
      await create({ ...base(), slots: [{ eventDate: nextDay(), slot: 'EVENING' }] })
    ).body;
    const stranger = await createUser(h.db, 'OWNER');
    const s = new Client(h.app);
    await s.login(stranger.email);
    expect(
      (await s.send('get', `/api/v1/owner/auditoriums/${venueId}/offline-bookings`)).status,
    ).toBe(404);
    expect(
      (await s.send('patch', `/api/v1/owner/offline-bookings/${created.id}`, { notes: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (await s.send('post', `/api/v1/owner/offline-bookings/${created.id}/cancel`)).status,
    ).toBe(404);

    const guest = await createUser(h.db, 'CUSTOMER');
    const c = new Client(h.app);
    await c.login(guest.email);
    expect(
      (await c.send('get', `/api/v1/owner/auditoriums/${venueId}/offline-bookings`)).status,
    ).toBe(403);

    const [event] = await h.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.entityId, created.id), eq(auditLogs.action, 'offline_booking.created')),
      );
    expect(JSON.stringify(event!.after)).toContain('2345');
    expect(JSON.stringify(event!.after)).not.toContain('9847012345');
  });
});
