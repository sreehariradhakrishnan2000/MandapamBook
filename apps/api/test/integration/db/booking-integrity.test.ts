import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PG_ERROR, type Db } from '../../../src/db/client.js';
import { availabilityBlocks, bookings, hallOccupancy } from '../../../src/db/schema/index.js';
import {
  bookingValues,
  createTestPool,
  createVenueFixture,
  hasTestDb,
  sqlState,
  testDb,
  uniqueDate,
  type VenueFixture,
} from '../../db-helpers.js';

describe.skipIf(!hasTestDb)('double booking is prevented by the database', () => {
  let pool: pg.Pool;
  let db: Db;
  let f: VenueFixture;

  beforeAll(async () => {
    pool = createTestPool(20);
    db = testDb(pool);
    f = await createVenueFixture(db);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const book = (opts: Parameters<typeof bookingValues>[1]) =>
    db.insert(bookings).values(bookingValues(f, opts)).returning();

  it('rejects a second active booking for the same hall, date and slot', async () => {
    const date = uniqueDate();
    await book({ date, slot: 'MORNING' });
    expect(await sqlState(() => book({ date, slot: 'MORNING' }))).toBe(
      PG_ERROR.EXCLUSION_VIOLATION,
    );
  });

  it('allows morning and evening on the same day', async () => {
    const date = uniqueDate();
    await book({ date, slot: 'MORNING' });
    await expect(book({ date, slot: 'EVENING' })).resolves.toHaveLength(1);
  });

  it('treats FULL_DAY as overlapping both morning and evening', async () => {
    const d1 = uniqueDate();
    await book({ date: d1, slot: 'MORNING' });
    expect(await sqlState(() => book({ date: d1, slot: 'FULL_DAY' }))).toBe(
      PG_ERROR.EXCLUSION_VIOLATION,
    );

    const d2 = uniqueDate();
    await book({ date: d2, slot: 'FULL_DAY' });
    expect(await sqlState(() => book({ date: d2, slot: 'EVENING' }))).toBe(
      PG_ERROR.EXCLUSION_VIOLATION,
    );
  });

  it('allows the same slot in a different hall of the same venue', async () => {
    const date = uniqueDate();
    await book({ date, slot: 'FULL_DAY' });
    await expect(book({ date, slot: 'FULL_DAY', hallId: f.secondHallId })).resolves.toHaveLength(1);
  });

  it('frees the slot when a booking expires or is cancelled', async () => {
    for (const terminal of ['EXPIRED', 'CANCELLED', 'REFUNDED'] as const) {
      const date = uniqueDate();
      const [first] = await book({ date, slot: 'MORNING' });
      await db.update(bookings).set({ status: terminal }).where(eq(bookings.id, first!.id));
      await expect(book({ date, slot: 'MORNING' })).resolves.toHaveLength(1);
    }
  });

  it('keeps the slot occupied for every active status', async () => {
    for (const active of ['PENDING_PAYMENT', 'AWAITING_OWNER', 'CONFIRMED', 'COMPLETED'] as const) {
      const date = uniqueDate();
      const [first] = await book({ date, slot: 'EVENING' });
      await db.update(bookings).set({ status: active }).where(eq(bookings.id, first!.id));
      expect(await sqlState(() => book({ date, slot: 'EVENING' }))).toBe(
        PG_ERROR.EXCLUSION_VIOLATION,
      );
    }
  });

  it('refuses to reactivate an expired booking once the slot is taken', async () => {
    const date = uniqueDate();
    const [stale] = await book({ date, slot: 'MORNING' });
    await db.update(bookings).set({ status: 'EXPIRED' }).where(eq(bookings.id, stale!.id));
    await book({ date, slot: 'MORNING' });
    expect(
      await sqlState(() =>
        db.update(bookings).set({ status: 'CONFIRMED' }).where(eq(bookings.id, stale!.id)),
      ),
    ).toBe(PG_ERROR.EXCLUSION_VIOLATION);
  });

  it('treats owner blocks like bookings, and deleting a block frees the slot', async () => {
    const date = uniqueDate();
    const [block] = await db
      .insert(availabilityBlocks)
      .values({ hallId: f.hallId, eventDate: date, slot: 'FULL_DAY', reason: 'Maintenance' })
      .returning();
    expect(await sqlState(() => book({ date, slot: 'MORNING' }))).toBe(
      PG_ERROR.EXCLUSION_VIOLATION,
    );

    await db.delete(availabilityBlocks).where(eq(availabilityBlocks.id, block!.id));
    await expect(book({ date, slot: 'MORNING' })).resolves.toHaveLength(1);

    expect(
      await sqlState(() =>
        db
          .insert(availabilityBlocks)
          .values({ hallId: f.hallId, eventDate: date, slot: 'MORNING' }),
      ),
    ).toBe(PG_ERROR.EXCLUSION_VIOLATION);
  });

  it('forbids moving a booking to another date or slot', async () => {
    const [b] = await book({ date: uniqueDate(), slot: 'MORNING' });
    expect(
      await sqlState(() =>
        db.update(bookings).set({ eventDate: uniqueDate() }).where(eq(bookings.id, b!.id)),
      ),
    ).toBe(PG_ERROR.CHECK_VIOLATION);
  });

  it('rejects a hall that belongs to a different auditorium', async () => {
    const other = await createVenueFixture(db);
    expect(
      await sqlState(() => book({ date: uniqueDate(), slot: 'MORNING', hallId: other.hallId })),
    ).toBe(PG_ERROR.FOREIGN_KEY_VIOLATION);
  });

  it('creates exactly one occupancy row per booking', async () => {
    const [b] = await book({ date: uniqueDate(), slot: 'EVENING' });
    const rows = await db.select().from(hallOccupancy).where(eq(hallOccupancy.bookingId, b!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hallId: f.hallId,
      slot: 'EVENING',
      active: true,
      slotSpan: '[1,2)',
    });
  });

  it('lets exactly one of many concurrent requests win the same slot', async () => {
    const date = uniqueDate();
    const attempts = 15;
    // Each attempt uses its own pooled connection and transaction, like real requests.
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        db.transaction((tx) =>
          tx
            .insert(bookings)
            .values(bookingValues(f, { date, slot: i % 2 ? 'FULL_DAY' : 'MORNING' })),
        ),
      ),
    );
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(attempts - 1);
    for (const r of lost) {
      expect(await sqlState(() => Promise.reject(r.reason))).toBe(PG_ERROR.EXCLUSION_VIOLATION);
    }
    const active = await db.select().from(hallOccupancy).where(eq(hallOccupancy.eventDate, date));
    expect(active.filter((o) => o.active && o.hallId === f.hallId)).toHaveLength(1);
  });
});

describe.skipIf(!hasTestDb)('one unpaid hold per customer', () => {
  let pool: pg.Pool;
  let db: Db;
  let f: VenueFixture;

  beforeAll(async () => {
    pool = createTestPool(5);
    db = testDb(pool);
    f = await createVenueFixture(db);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('rejects a second HELD or PENDING_PAYMENT booking for the same customer', async () => {
    const [first] = await db
      .insert(bookings)
      .values(bookingValues(f, { date: uniqueDate(), slot: 'MORNING', status: 'HELD' }))
      .returning();
    expect(
      await sqlState(() =>
        db
          .insert(bookings)
          .values(
            bookingValues(f, { date: uniqueDate(), slot: 'EVENING', status: 'PENDING_PAYMENT' }),
          ),
      ),
    ).toBe(PG_ERROR.UNIQUE_VIOLATION);
    // Once the first hold is no longer active, a new one is allowed.
    await db.update(bookings).set({ status: 'EXPIRED' }).where(eq(bookings.id, first!.id));
    await expect(
      db
        .insert(bookings)
        .values(bookingValues(f, { date: uniqueDate(), slot: 'EVENING', status: 'HELD' })),
    ).resolves.toBeDefined();
  });
});
