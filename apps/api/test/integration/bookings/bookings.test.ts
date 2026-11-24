import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addons,
  auditoriums,
  availabilityBlocks,
  bookingStatusHistory,
  bookings,
  cancellationPolicies,
  cities,
  halls,
  media,
  ownerProfiles,
  pricingRules,
} from '../../../src/db/schema/index.js';
import { runSweep } from '../../../src/jobs/sweeper.js';
import { quote } from '../../../src/modules/bookings/pricing.js';
import { IllegalTransitionError, transition } from '../../../src/modules/bookings/state-machine.js';
import { todayInIst } from '../../../src/lib/time.js';
import { hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

/** A date `days` from today (IST), as YYYY-MM-DD. */
function inDays(days: number): string {
  const [y, m, d] = todayInIst().split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** Next Wednesday at least `minDays` away, so weekend pricing never interferes. */
function weekdayAtLeast(minDays: number): string {
  for (let i = minDays; ; i++) {
    const d = inDays(i);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 3) return d;
  }
}

describe.skipIf(!hasTestDb)('search, quotes, holds and bookings', { timeout: 120_000 }, () => {
  let h: Harness;
  let citySlug: string;
  let venue: { id: string; slug: string };
  let hallId: string;
  let addonId: string;
  let owner: { id: string; email: string };
  let dateCounter = 30;
  const nextDate = () => weekdayAtLeast((dateCounter += 7));

  async function customer(verified = true) {
    const u = await createUser(h.db, 'CUSTOMER', verified ? {} : { emailVerifiedAt: null });
    const c = new Client(h.app);
    await c.login(u.email);
    return { ...u, c };
  }

  async function approvedVenue(
    ownerId: string,
    cityId: string,
    name: string,
    status: 'APPROVED' | 'DRAFT' = 'APPROVED',
  ) {
    const [a] = await h.db
      .insert(auditoriums)
      .values({
        ownerId,
        cityId,
        name,
        slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomBytes(2).toString('hex')}`,
        addressLine: '22 Kutchery Road',
        pincode: '600004',
        cateringPolicy: 'IN_HOUSE_ONLY',
        decorationPolicy: 'OUTSIDE_ALLOWED',
        parkingCars: 60,
        guestRooms: 12,
        advancePercent: 25,
        status,
      })
      .returning();
    const [hall] = await h.db
      .insert(halls)
      .values({ auditoriumId: a!.id, name: 'Mahal', seatingCapacity: 800, isAc: true })
      .returning();
    await h.db.insert(pricingRules).values([
      { hallId: hall!.id, slot: 'MORNING', kind: 'BASE', pricePaise: 12_000_000, priority: 0 },
      { hallId: hall!.id, slot: 'EVENING', kind: 'BASE', pricePaise: 9_500_000, priority: 0 },
      { hallId: hall!.id, slot: 'FULL_DAY', kind: 'BASE', pricePaise: 20_000_000, priority: 0 },
      { hallId: hall!.id, slot: 'MORNING', kind: 'WEEKEND', pricePaise: 13_200_000, priority: 10 },
    ]);
    const [addon] = await h.db
      .insert(addons)
      .values({
        auditoriumId: a!.id,
        code: 'guest_room',
        name: 'Guest room',
        unit: 'PER_ROOM',
        pricePaise: 280_000,
        maxQuantity: 12,
      })
      .returning();
    await h.db.insert(cancellationPolicies).values({
      auditoriumId: a!.id,
      tiers: [
        { minDaysBefore: 60, refundPercent: 90 },
        { minDaysBefore: 0, refundPercent: 0 },
      ],
    });
    return { venue: { id: a!.id, slug: a!.slug }, hallId: hall!.id, addonId: addon!.id };
  }

  beforeAll(async () => {
    h = await createHarness({
      limitOverrides: { holdPerUser: { points: 1000, windowSeconds: 60 } },
    });
    citySlug = `chennai-${randomBytes(3).toString('hex')}`;
    const [city] = await h.db
      .insert(cities)
      .values({ name: 'Chennai', slug: citySlug, district: 'Chennai', state: 'Tamil Nadu' })
      .returning();
    owner = await createUser(h.db, 'OWNER');
    await h.db
      .update(ownerProfiles)
      .set({ businessName: 'Sundaram Mahal Group' })
      .where(eq(ownerProfiles.userId, owner.id));
    ({ venue, hallId, addonId } = await approvedVenue(
      owner.id,
      city!.id,
      'Sundaram Thirumana Mahal',
    ));
    await approvedVenue(owner.id, city!.id, 'Hidden Draft Hall', 'DRAFT');
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('public search and venue page', () => {
    it('lists approved venues only, with prices and filters applied', async () => {
      const c = new Client(h.app);
      const res = await c.send('get', `/api/v1/auditoriums?city=${citySlug}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((v: { name: string }) => v.name)).toEqual([
        'Sundaram Thirumana Mahal',
      ]);
      expect(res.body.items[0]).toMatchObject({
        fromPricePaise: 9_500_000,
        maxCapacity: 800,
        hasAc: true,
        available: null,
      });

      expect(
        (await c.send('get', `/api/v1/auditoriums?city=${citySlug}&guests=900`)).body.items,
      ).toHaveLength(0);
      expect(
        (await c.send('get', `/api/v1/auditoriums?city=${citySlug}&maxPricePaise=9000000`)).body
          .items,
      ).toHaveLength(0);
      expect(
        (await c.send('get', `/api/v1/auditoriums?city=${citySlug}&minRooms=20`)).body.items,
      ).toHaveLength(0);
      expect(
        (await c.send('get', `/api/v1/auditoriums?city=${citySlug}&catering=OUTSIDE_ALLOWED`)).body
          .items,
      ).toHaveLength(0);
      expect((await c.send('get', `/api/v1/auditoriums?date=2020-01-01`)).status).toBe(400);
    });

    it('reports dining AC and sadya facilities and filters by sadya', async () => {
      const c = new Client(h.app);
      const before = await c.send('get', `/api/v1/auditoriums?city=${citySlug}&sadya=true`);
      expect(before.body.items).toHaveLength(0);

      await h.db
        .update(auditoriums)
        .set({ sadyaPrepArea: true, cookingEquipment: true })
        .where(eq(auditoriums.id, venue.id));
      // Dining AC only counts for a hall that has a dining area at all.
      await h.db
        .update(halls)
        .set({ diningIsAc: true, diningCapacity: 400 })
        .where(eq(halls.id, hallId));

      const after = await c.send('get', `/api/v1/auditoriums?city=${citySlug}&sadya=true`);
      expect(after.body.items.map((v: { id: string }) => v.id)).toEqual([venue.id]);
      expect(after.body.items[0]).toMatchObject({
        hasAc: true,
        diningAc: true,
        sadyaPrepArea: true,
        cookingEquipment: true,
      });
      const page = await c.send('get', `/api/v1/auditoriums/${venue.slug}`);
      expect(page.body).toMatchObject({ sadyaPrepArea: true, cookingEquipment: true });
      expect(page.body.halls[0]).toMatchObject({ isAc: true, diningIsAc: true });
    });

    it('finds venues near a location, nearest first, with the distance', async () => {
      await h.db
        .update(auditoriums)
        .set({ latitude: 13.0339, longitude: 80.2619 })
        .where(eq(auditoriums.id, venue.id));
      const c = new Client(h.app);
      const near = await c.send(
        'get',
        '/api/v1/auditoriums?lat=13.0339&lng=80.27&radiusKm=5&sort=distance',
      );
      expect(near.status).toBe(200);
      const found = near.body.items.find((v: { id: string }) => v.id === venue.id);
      expect(found.distanceKm).toBeCloseTo(0.9, 1);

      const far = await c.send('get', '/api/v1/auditoriums?lat=9.9312&lng=76.2673&radiusKm=50');
      expect(far.body.items.map((v: { id: string }) => v.id)).not.toContain(venue.id);

      const plain = await c.send('get', `/api/v1/auditoriums?city=${citySlug}`);
      expect(plain.body.items[0].distanceKm).toBeNull();

      expect((await c.send('get', '/api/v1/auditoriums?lat=13.03')).status).toBe(400);
      expect((await c.send('get', '/api/v1/auditoriums?sort=distance')).status).toBe(400);
    });

    it('prices for the requested date and hides venues whose slot is taken', async () => {
      const date = nextDate();
      const c = new Client(h.app);
      const free = await c.send(
        'get',
        `/api/v1/auditoriums?city=${citySlug}&date=${date}&slot=MORNING`,
      );
      expect(free.body.items[0]).toMatchObject({ fromPricePaise: 12_000_000, available: true });
      await h.db.insert(availabilityBlocks).values({ hallId, eventDate: date, slot: 'FULL_DAY' });
      const taken = await c.send(
        'get',
        `/api/v1/auditoriums?city=${citySlug}&date=${date}&slot=EVENING`,
      );
      expect(taken.body.items).toHaveLength(0);
    });

    it('shows the venue page without the owner’s personal contact details', async () => {
      const c = new Client(h.app);
      const res = await c.send('get', `/api/v1/auditoriums/${venue.slug}`);
      expect(res.status).toBe(200);
      expect(res.body.halls[0].basePrices).toEqual({
        MORNING: 12_000_000,
        EVENING: 9_500_000,
        FULL_DAY: 20_000_000,
      });
      expect(res.body.addons[0]).toMatchObject({ code: 'guest_room', pricePaise: 280_000 });
      expect(res.body.hostedBy).toBe('Sundaram Mahal Group');
      expect(JSON.stringify(res.body)).not.toContain(owner.email);
      expect((await c.send('get', '/api/v1/auditoriums/hidden-draft-hall')).status).toBe(404);
    });

    it('reports taken slots per month without saying who booked them', async () => {
      const date = nextDate();
      await h.db
        .insert(availabilityBlocks)
        .values({ hallId, eventDate: date, slot: 'EVENING', reason: 'Private family function' });
      const res = await new Client(h.app).send(
        'get',
        `/api/v1/auditoriums/${venue.id}/availability?month=${date.slice(0, 7)}`,
      );
      expect(res.body.halls[0].taken[date]).toEqual(['EVENING']);
      expect(JSON.stringify(res.body)).not.toContain('Private family');
    });
  });

  describe('quotes', () => {
    it('matches the pure pricing function and ignores anything the client claims', async () => {
      const date = nextDate();
      const res = await new Client(h.app).send('post', '/api/v1/bookings/quote', {
        hallId,
        eventDate: date,
        slot: 'MORNING',
        guestCount: 500,
        addons: [{ addonId, quantity: 4 }],
      });
      expect(res.status).toBe(200);
      const expected = quote({
        basePaise: 12_000_000,
        addons: [
          { addonId, code: 'guest_room', name: 'Guest room', quantity: 4, unitPaise: 280_000 },
        ],
        gstBasisPoints: 1800,
        platformFeePaise: 49_900,
        advancePercent: 25,
      });
      expect(res.body).toMatchObject({
        totalPaise: expected.totalPaise,
        gstPaise: expected.gstPaise,
        payNowPaise: expected.payNowPaise,
        payLaterPaise: expected.payLaterPaise,
        ruleKind: 'BASE',
        available: true,
      });
      const tampered = await new Client(h.app).send('post', '/api/v1/bookings/quote', {
        hallId,
        eventDate: date,
        slot: 'MORNING',
        guestCount: 500,
        totalPaise: 1,
      });
      expect(tampered.status).toBe(400);
    });

    it('rejects past dates, too many guests, unknown halls and other venues’ add-ons', async () => {
      const c = new Client(h.app);
      const base = { hallId, eventDate: nextDate(), slot: 'MORNING', guestCount: 100 };
      expect(
        (await c.send('post', '/api/v1/bookings/quote', { ...base, eventDate: '2020-01-01' })).body
          .error.code,
      ).toBe('DATE_IN_PAST');
      expect(
        (await c.send('post', '/api/v1/bookings/quote', { ...base, guestCount: 801 })).body.error
          .code,
      ).toBe('TOO_MANY_GUESTS');
      expect(
        (await c.send('post', '/api/v1/bookings/quote', { ...base, hallId: crypto.randomUUID() }))
          .status,
      ).toBe(404);
      expect(
        (
          await c.send('post', '/api/v1/bookings/quote', {
            ...base,
            addons: [{ addonId: crypto.randomUUID(), quantity: 1 }],
          })
        ).body.error.code,
      ).toBe('INVALID_ADDON');
      expect(
        (
          await c.send('post', '/api/v1/bookings/quote', {
            ...base,
            addons: [{ addonId, quantity: 13 }],
          })
        ).body.error.code,
      ).toBe('INVALID_ADDON');
    });
  });

  describe('holds', () => {
    it('requires a verified email', async () => {
      const unverified = await customer(false);
      const res = await unverified.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: nextDate(),
        slot: 'MORNING',
        guestCount: 200,
      });
      expect(res.status).toBe(403);
    });

    it('holds a slot for the configured minutes with a server-computed price', async () => {
      const cust = await customer();
      const date = nextDate();
      const before = Date.now();
      const res = await cust.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: date,
        slot: 'EVENING',
        guestCount: 300,
      });
      expect(res.status).toBe(201);
      expect(res.body.refCode).toMatch(/^MB-[2-9A-HJ-NP-Z]{6}$/);
      expect(res.body.status).toBe('HELD');
      const expiry = new Date(res.body.holdExpiresAt).getTime();
      expect(expiry - before).toBeGreaterThan(9 * 60_000);
      expect(expiry - before).toBeLessThan(11 * 60_000);

      const [row] = await h.db.select().from(bookings).where(eq(bookings.id, res.body.id));
      expect(row).toMatchObject({
        subtotalPaise: 9_500_000,
        advancePaise: res.body.quote.payNowPaise,
        status: 'HELD',
      });
      const history = await h.db
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, row!.id));
      expect(history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'HELD' })]);
    });

    it('allows one unpaid hold per customer and one booking per slot', async () => {
      const a = await customer();
      const b = await customer();
      const date = nextDate();
      expect(
        (
          await a.c.send('post', '/api/v1/bookings', {
            hallId,
            eventDate: date,
            slot: 'MORNING',
            guestCount: 100,
          })
        ).status,
      ).toBe(201);
      const second = await a.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: nextDate(),
        slot: 'MORNING',
        guestCount: 100,
      });
      expect(second.body.error.code).toBe('HOLD_EXISTS');
      const clash = await b.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: date,
        slot: 'FULL_DAY',
        guestCount: 100,
      });
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('SLOT_UNAVAILABLE');
    });

    it('lets exactly one of many customers hold the same slot at the same moment', async () => {
      const date = nextDate();
      const customers = await Promise.all(Array.from({ length: 8 }, () => customer()));
      const results = await Promise.all(
        customers.map((c) =>
          c.c.send('post', '/api/v1/bookings', {
            hallId,
            eventDate: date,
            slot: 'FULL_DAY',
            guestCount: 400,
          }),
        ),
      );
      // Losers must get a clean 409, not a 500 from a deadlock on the exclusion constraint
      // (which CI's fast Postgres used to hit). The message shows every response.
      const seen = JSON.stringify(results.map((r) => [r.status, r.body?.error?.code]));
      expect(
        results.filter((r) => r.status === 201),
        seen,
      ).toHaveLength(1);
      expect(
        results.filter((r) => r.status === 409 && r.body.error.code === 'SLOT_UNAVAILABLE'),
        seen,
      ).toHaveLength(7);
    });

    it('lets exactly one of an owner block and customer holds take a date at once', async () => {
      const date = nextDate();
      const ownerClient = new Client(h.app);
      await ownerClient.login(owner.email);
      const customers = await Promise.all(Array.from({ length: 4 }, () => customer()));
      const results = await Promise.all([
        ownerClient.send('post', `/api/v1/owner/halls/${hallId}/blocks`, {
          eventDate: date,
          slot: 'FULL_DAY',
          reason: 'Maintenance',
        }),
        ...customers.map((c) =>
          c.c.send('post', '/api/v1/bookings', {
            hallId,
            eventDate: date,
            slot: 'FULL_DAY',
            guestCount: 400,
          }),
        ),
      ]);
      const seen = JSON.stringify(results.map((r) => [r.status, r.body?.error?.code]));
      expect(
        results.filter((r) => r.status === 201),
        seen,
      ).toHaveLength(1);
      expect(
        results.filter((r) => r.status === 409),
        seen,
      ).toHaveLength(4);
    });

    it('frees an expired hold the moment someone else asks for the slot', async () => {
      const first = await customer();
      const second = await customer();
      const date = nextDate();
      const held = await first.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: date,
        slot: 'MORNING',
        guestCount: 100,
      });
      await h.db
        .update(bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(bookings.id, held.body.id));

      // The sweeper has not run, yet the slot is already shown as free and can be held.
      const search = await new Client(h.app).send(
        'get',
        `/api/v1/auditoriums?city=${citySlug}&date=${date}&slot=MORNING`,
      );
      expect(search.status, JSON.stringify(search.body)).toBe(200);
      expect(search.body.items).toHaveLength(1);
      const res = await second.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: date,
        slot: 'MORNING',
        guestCount: 100,
      });
      expect(res.status).toBe(201);
      const [old] = await h.db.select().from(bookings).where(eq(bookings.id, held.body.id));
      expect(old!.status).toBe('EXPIRED');
    });
  });

  describe('customer bookings and cancellation', () => {
    it('lists and shows only the customer’s own bookings', async () => {
      const mine = await customer();
      const other = await customer();
      const res = await mine.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: nextDate(),
        slot: 'EVENING',
        guestCount: 150,
        addons: [{ addonId, quantity: 2 }],
      });
      const list = await mine.c.send('get', '/api/v1/bookings/mine');
      expect(list.body.items.map((b: { id: string }) => b.id)).toEqual([res.body.id]);
      const detail = await mine.c.send('get', `/api/v1/bookings/${res.body.id}`);
      expect(detail.body).toMatchObject({
        refCode: res.body.refCode,
        venueName: 'Sundaram Thirumana Mahal',
        addonsPaise: 560_000,
      });
      expect((await other.c.send('get', `/api/v1/bookings/${res.body.id}`)).status).toBe(404);
      expect(
        (await other.c.send('post', `/api/v1/bookings/${res.body.id}/cancel`, {})).status,
      ).toBe(404);
    });

    it('cancels an unpaid hold with nothing refunded, freeing the slot, and only once', async () => {
      const cust = await customer();
      const date = nextDate();
      const res = await cust.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: date,
        slot: 'MORNING',
        guestCount: 100,
      });
      const preview = await cust.c.send('get', `/api/v1/bookings/${res.body.id}/cancel-preview`);
      expect(preview.body).toMatchObject({ refundPaise: 0, retainedPaise: 0 });
      const cancel = await cust.c.send('post', `/api/v1/bookings/${res.body.id}/cancel`, {
        reason: 'Changed plans',
      });
      expect(cancel.body.status).toBe('CANCELLED');
      expect((await cust.c.send('post', `/api/v1/bookings/${res.body.id}/cancel`, {})).status).toBe(
        409,
      );
      const again = await (
        await customer()
      ).c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: date,
        slot: 'MORNING',
        guestCount: 100,
      });
      expect(again.status).toBe(201);
    });

    it('refuses illegal transitions at the service layer', async () => {
      const cust = await customer();
      const res = await cust.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: nextDate(),
        slot: 'EVENING',
        guestCount: 100,
      });
      const [row] = await h.db.select().from(bookings).where(eq(bookings.id, res.body.id));
      await expect(
        h.db.transaction((tx) =>
          transition(tx, {
            bookingId: row!.id,
            from: 'HELD',
            to: 'CONFIRMED',
            version: row!.version,
          }),
        ),
      ).rejects.toBeInstanceOf(IllegalTransitionError);
    });
  });

  describe('sweeper', () => {
    it('expires stale holds, completes past events and removes abandoned uploads', async () => {
      const cust = await customer();
      const held = await cust.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: nextDate(),
        slot: 'EVENING',
        guestCount: 100,
      });
      await h.db
        .update(bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(bookings.id, held.body.id));

      const past = await createUser(h.db, 'CUSTOMER');
      const [done] = await h.db
        .insert(bookings)
        .values({
          refCode: `MB-${randomBytes(3).toString('hex').toUpperCase()}`,
          customerId: past.id,
          auditoriumId: venue.id,
          hallId,
          eventDate: inDays(-3),
          slot: 'MORNING',
          guestCount: 100,
          status: 'CONFIRMED',
          subtotalPaise: 100,
          gstPaise: 18,
          platformFeePaise: 0,
          totalPaise: 118,
          advancePaise: 30,
          priceSnapshot: {
            baseRuleId: 'x',
            basePaise: 100,
            addons: [],
            gstBasisPoints: 1800,
            platformFeePaise: 0,
            cancellationTiers: [],
          },
        })
        .returning();
      const [upload] = await h.db
        .insert(media)
        .values({
          auditoriumId: venue.id,
          storageKey: `venues/${venue.id}/stale-${randomBytes(4).toString('hex')}.png`,
          mimeType: 'image/png',
          sizeBytes: 10,
          status: 'PENDING_UPLOAD',
          createdAt: new Date(Date.now() - 2 * 86_400_000),
        })
        .returning();

      const result = await runSweep({
        pool: h.pool,
        db: h.db,
        bookingService: h.container.bookings,
        storage: h.storage,
        logger: pino({ level: 'silent' }),
      });
      expect(result.ran).toBe(true);
      expect(result.expiredHolds).toBeGreaterThanOrEqual(1);
      expect(result.completed).toBeGreaterThanOrEqual(1);
      expect(result.removedUploads).toBeGreaterThanOrEqual(1);

      const [expired] = await h.db.select().from(bookings).where(eq(bookings.id, held.body.id));
      expect(expired!.status).toBe('EXPIRED');
      const [completed] = await h.db.select().from(bookings).where(eq(bookings.id, done!.id));
      expect(completed!.status).toBe('COMPLETED');
      expect(await h.db.select().from(media).where(eq(media.id, upload!.id))).toHaveLength(0);
    });

    it('does nothing while another worker holds the sweep lock', async () => {
      const client = await h.pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(7420001)');
        const result = await runSweep({
          pool: h.pool,
          db: h.db,
          bookingService: h.container.bookings,
          storage: h.storage,
          logger: pino({ level: 'silent' }),
        });
        expect(result.ran).toBe(false);
      } finally {
        await client.query('SELECT pg_advisory_unlock(7420001)');
        client.release();
      }
    });
  });

  describe('owner inbox and admin view', () => {
    it('shows the owner their bookings, hiding customer details until paid, and accepts paid requests', async () => {
      const ownerClient = new Client(h.app);
      await ownerClient.login(owner.email);
      const cust = await customer();
      const res = await cust.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: nextDate(),
        slot: 'EVENING',
        guestCount: 120,
      });
      const inbox = await ownerClient.send('get', '/api/v1/owner/bookings');
      const held = inbox.body.items.find((b: { id: string }) => b.id === res.body.id);
      expect(held.customer).toBeNull();
      expect(
        (await ownerClient.send('post', `/api/v1/owner/bookings/${res.body.id}/accept`)).status,
      ).toBe(409);

      // Simulate a paid request-mode booking (payments arrive in Phase 6).
      const [row] = await h.db.select().from(bookings).where(eq(bookings.id, res.body.id));
      await h.db
        .update(bookings)
        .set({ status: 'AWAITING_OWNER', version: row!.version + 1 })
        .where(eq(bookings.id, row!.id));
      const paid = (
        await ownerClient.send('get', '/api/v1/owner/bookings?status=AWAITING_OWNER')
      ).body.items.find((b: { id: string }) => b.id === res.body.id);
      expect(paid.customer.email).toBe(cust.email);
      const accept = await ownerClient.send('post', `/api/v1/owner/bookings/${res.body.id}/accept`);
      expect(accept.body.status).toBe('CONFIRMED');
      const balance = await ownerClient.send(
        'post',
        `/api/v1/owner/bookings/${res.body.id}/balance-received`,
      );
      expect(balance.body.balanceReceivedAt).toBeTruthy();

      const stranger = await createUser(h.db, 'OWNER');
      const s = new Client(h.app);
      await s.login(stranger.email);
      expect((await s.send('get', '/api/v1/owner/bookings')).body.items).toHaveLength(0);
      expect(
        (await s.send('post', `/api/v1/owner/bookings/${res.body.id}/balance-received`)).status,
      ).toBe(404);
    });

    it('gives admins the platform-wide list', async () => {
      const admin = new Client(h.app);
      await admin.login((await createUser(h.db, 'ADMIN')).email);
      const res = await admin.send('get', '/api/v1/admin/bookings?limit=5');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      const cust = await customer();
      expect((await cust.c.send('get', '/api/v1/admin/bookings')).status).toBe(403);
    });
  });

  it('keeps double-booking protection when a hold and an owner block race', async () => {
    const date = nextDate();
    const cust = await customer();
    const [hold, block] = await Promise.allSettled([
      cust.c.send('post', '/api/v1/bookings', {
        hallId,
        eventDate: date,
        slot: 'FULL_DAY',
        guestCount: 100,
      }),
      h.db.insert(availabilityBlocks).values({ hallId, eventDate: date, slot: 'MORNING' }),
    ]);
    const holdOk = hold.status === 'fulfilled' && hold.value.status === 201;
    const blockOk = block.status === 'fulfilled';
    expect(holdOk !== blockOk).toBe(true);
    const active = await h.db
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.hallId, hallId), eq(bookings.eventDate, date), eq(bookings.status, 'HELD')),
      );
    expect(active.length).toBe(holdOk ? 1 : 0);
  });
});
