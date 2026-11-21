import { count, eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../src/db/client.js';
import {
  auditoriums,
  cities,
  halls,
  platformSettings,
  pricingRules,
} from '../../../src/db/schema/index.js';
import { AMENITIES, CITIES } from '../../../src/db/seed/master-data.js';
import { SAMPLE_AUDITORIUMS } from '../../../src/db/seed/sample-data.js';
import { seedMasterData, seedSampleData } from '../../../src/db/seed/seed.js';
import { createTestPool, hasTestDb, testDb } from '../../db-helpers.js';

describe.skipIf(!hasTestDb)('seed', () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(async () => {
    pool = createTestPool();
    db = testDb(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('loads master and sample data and is idempotent', async () => {
    await seedMasterData(db);
    const first = await seedSampleData(db);
    expect(first).toEqual({ auditoriumsCreated: SAMPLE_AUDITORIUMS.length, auditoriumsSkipped: 0 });

    await seedMasterData(db);
    const second = await seedSampleData(db);
    expect(second).toEqual({
      auditoriumsCreated: 0,
      auditoriumsSkipped: SAMPLE_AUDITORIUMS.length,
    });

    const slugs = CITIES.map((c) => c.slug);
    const cityRows = await db.select({ slug: cities.slug }).from(cities);
    expect(cityRows.map((c) => c.slug)).toEqual(expect.arrayContaining(slugs));
    expect(AMENITIES.length).toBeGreaterThan(10);
  });

  it('prices every slot of every sample hall in integer paise with uplifts above base', async () => {
    const venue = SAMPLE_AUDITORIUMS[0]!;
    const [aud] = await db.select().from(auditoriums).where(eq(auditoriums.slug, venue.slug));
    const [hall] = await db.select().from(halls).where(eq(halls.auditoriumId, aud!.id)).limit(1);
    const rules = await db.select().from(pricingRules).where(eq(pricingRules.hallId, hall!.id));
    expect(rules).toHaveLength(9); // 3 slots × BASE/WEEKEND/MUHURTHAM
    for (const r of rules) expect(Number.isSafeInteger(r.pricePaise)).toBe(true);
    const morning = rules.filter((r) => r.slot === 'MORNING');
    const base = morning.find((r) => r.kind === 'BASE')!.pricePaise;
    expect(morning.find((r) => r.kind === 'MUHURTHAM')!.pricePaise).toBeGreaterThan(base);
  });

  it('does not overwrite platform settings an admin has changed', async () => {
    await db
      .update(platformSettings)
      .set({ value: 999 })
      .where(eq(platformSettings.key, 'commission_bps'));
    await seedMasterData(db);
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'commission_bps'));
    expect(row!.value).toBe(999);
    const [{ n }] = (await db.select({ n: count() }).from(platformSettings)) as [{ n: number }];
    expect(n).toBeGreaterThanOrEqual(5);
  });
});
