import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDb, pgErrorCode, type Db } from '../src/db/client.js';
import type { bookings } from '../src/db/schema/index.js';
import { auditoriums, cities, halls, ownerProfiles, users } from '../src/db/schema/index.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasTestDb = Boolean(TEST_DATABASE_URL);

export function createTestPool(max = 5): pg.Pool {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max, keepAlive: true });
  // The remote test database occasionally drops idle connections; the pool recovers.
  pool.on('error', () => undefined);
  return pool;
}

export function testDb(pool: pg.Pool): Db {
  return createDb(pool);
}

/** Runs fn and returns the Postgres SQLSTATE it failed with (or undefined on success). */
export async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    const code = pgErrorCode(err);
    if (!code) throw err;
    return code;
  }
}

export interface VenueFixture {
  ownerId: string;
  customerId: string;
  auditoriumId: string;
  hallId: string;
  secondHallId: string;
}

/** Creates an owner, a customer, an approved auditorium and two halls with unique names. */
export async function createVenueFixture(db: Db): Promise<VenueFixture> {
  const tag = randomUUID().slice(0, 8);
  const [city] = await db
    .insert(cities)
    .values({ name: `City ${tag}`, slug: `city-${tag}`, district: 'Ernakulam', state: 'Kerala' })
    .returning();
  const [owner] = await db
    .insert(users)
    .values({
      email: `owner-${tag}@example.test`,
      fullName: 'Test Owner',
      role: 'OWNER',
      status: 'ACTIVE',
    })
    .returning();
  const [customer] = await db
    .insert(users)
    .values({ email: `customer-${tag}@example.test`, fullName: 'Test Customer', status: 'ACTIVE' })
    .returning();
  if (!city || !owner || !customer) throw new Error('fixture insert failed');
  await db.insert(ownerProfiles).values({ userId: owner.id, businessName: `Biz ${tag}` });
  const [aud] = await db
    .insert(auditoriums)
    .values({
      ownerId: owner.id,
      cityId: city.id,
      name: `Hall ${tag}`,
      slug: `hall-${tag}`,
      addressLine: '1 Test Road',
      pincode: '682001',
      cateringPolicy: 'OUTSIDE_ALLOWED',
      decorationPolicy: 'OUTSIDE_ALLOWED',
      status: 'APPROVED',
    })
    .returning();
  if (!aud) throw new Error('fixture insert failed');
  const [h1, h2] = await db
    .insert(halls)
    .values([
      { auditoriumId: aud.id, name: 'Main', seatingCapacity: 500 },
      { auditoriumId: aud.id, name: 'Annex', seatingCapacity: 200 },
    ])
    .returning();
  if (!h1 || !h2) throw new Error('fixture insert failed');
  return {
    ownerId: owner.id,
    customerId: customer.id,
    auditoriumId: aud.id,
    hallId: h1.id,
    secondHallId: h2.id,
  };
}

type Slot = 'MORNING' | 'EVENING' | 'FULL_DAY';
type Status = (typeof bookings.$inferInsert)['status'];

let dayCounter = 0;
/** A distinct future date per call, so tests in one file never share a hall-date. */
export function uniqueDate(): string {
  dayCounter++;
  const d = new Date(Date.UTC(2030, 0, 1) + dayCounter * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function bookingValues(
  f: VenueFixture,
  opts: { date: string; slot: Slot; hallId?: string; status?: Status },
): typeof bookings.$inferInsert {
  // CONFIRMED occupies the slot like a hold but is not limited to one per customer.
  const status = opts.status ?? 'CONFIRMED';
  return {
    refCode: `MB-${randomUUID().slice(0, 8).toUpperCase()}`,
    customerId: f.customerId,
    auditoriumId: f.auditoriumId,
    hallId: opts.hallId ?? f.hallId,
    eventDate: opts.date,
    slot: opts.slot,
    guestCount: 300,
    status,
    holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    subtotalPaise: 10_000_000,
    addonsPaise: 0,
    gstPaise: 1_800_000,
    platformFeePaise: 49_900,
    totalPaise: 11_849_900,
    advancePaise: 2_962_475,
    priceSnapshot: {
      baseRuleId: randomUUID(),
      basePaise: 10_000_000,
      addons: [],
      gstBasisPoints: 1800,
      platformFeePaise: 49_900,
      cancellationTiers: [],
    },
  };
}
