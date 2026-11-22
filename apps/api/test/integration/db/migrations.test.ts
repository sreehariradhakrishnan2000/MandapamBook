import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/db/migrate.js';
import { createTestPool, hasTestDb, TEST_DATABASE_URL } from '../../db-helpers.js';

describe.skipIf(!hasTestDb)('migrations', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createTestPool(2);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('are re-runnable (already-applied migrations are skipped)', async () => {
    await expect(runMigrations(TEST_DATABASE_URL!)).resolves.toBeUndefined();
  });

  it('create the required extensions', async () => {
    const { rows } = await pool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('citext', 'pg_trgm', 'btree_gist')`,
    );
    expect(rows.map((r) => r.extname).sort()).toEqual(['btree_gist', 'citext', 'pg_trgm']);
  });

  it('install the booking exclusion constraint', async () => {
    const { rows } = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'hall_occupancy_no_overlap'`,
    );
    expect(rows[0]?.def).toMatch(/EXCLUDE USING gist/);
    expect(rows[0]?.def).toMatch(/slot_span WITH &&/);
    expect(rows[0]?.def).toMatch(/WHERE \(active\)/);
  });

  it('store money columns as bigint', async () => {
    const { rows } = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name LIKE '%paise'`,
    );
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) expect(r.data_type, `${r.table_name}.${r.column_name}`).toBe('bigint');
  });
});
