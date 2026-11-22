import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PG_ERROR, type Db } from '../../../src/db/client.js';
import { auditLogs, bookings, users } from '../../../src/db/schema/index.js';
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

describe.skipIf(!hasTestDb)('schema constraints', () => {
  let pool: pg.Pool;
  let db: Db;
  let f: VenueFixture;

  beforeAll(async () => {
    pool = createTestPool();
    db = testDb(pool);
    f = await createVenueFixture(db);
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe('money is integer paise and must add up', () => {
    it('rejects a total that does not equal its parts', async () => {
      const v = { ...bookingValues(f, { date: uniqueDate(), slot: 'MORNING' }), totalPaise: 1 };
      expect(await sqlState(() => db.insert(bookings).values(v))).toBe(PG_ERROR.CHECK_VIOLATION);
    });

    it('rejects negative amounts', async () => {
      const base = bookingValues(f, { date: uniqueDate(), slot: 'MORNING' });
      const v = { ...base, gstPaise: -100, totalPaise: base.totalPaise! - base.gstPaise! - 100 };
      expect(await sqlState(() => db.insert(bookings).values(v))).toBe(PG_ERROR.CHECK_VIOLATION);
    });

    it('rejects an advance larger than the total', async () => {
      const base = bookingValues(f, { date: uniqueDate(), slot: 'MORNING' });
      const v = { ...base, advancePaise: base.totalPaise! + 1 };
      expect(await sqlState(() => db.insert(bookings).values(v))).toBe(PG_ERROR.CHECK_VIOLATION);
    });

    it('stores fractional paise as an error, never a rounded value', async () => {
      const code = await sqlState(() => db.execute(sql`SELECT ${'10.5'}::bigint`));
      expect(code).toBe('22P02'); // invalid_text_representation
    });

    it('requires a hold expiry while a booking is held', async () => {
      const v = {
        ...bookingValues(f, { date: uniqueDate(), slot: 'MORNING' }),
        holdExpiresAt: null,
      };
      expect(await sqlState(() => db.insert(bookings).values(v))).toBe(PG_ERROR.CHECK_VIOLATION);
    });
  });

  describe('users', () => {
    it('treats emails case-insensitively for uniqueness', async () => {
      await db.insert(users).values({ email: 'Priya.Nair@Example.test', fullName: 'Priya' });
      expect(
        await sqlState(() =>
          db.insert(users).values({ email: 'priya.nair@example.test', fullName: 'Priya 2' }),
        ),
      ).toBe(PG_ERROR.UNIQUE_VIOLATION);
    });

    it('accepts only E.164 Indian mobile numbers', async () => {
      expect(
        await sqlState(() =>
          db
            .insert(users)
            .values({ email: 'bad-phone@example.test', fullName: 'X', phone: '9876543210' }),
        ),
      ).toBe(PG_ERROR.CHECK_VIOLATION);
      await expect(
        db
          .insert(users)
          .values({ email: 'good-phone@example.test', fullName: 'Y', phone: '+919876543210' }),
      ).resolves.toBeDefined();
    });
  });

  describe('audit log is append-only', () => {
    it('allows inserts but blocks update, delete and truncate', async () => {
      const [row] = await db
        .insert(auditLogs)
        .values({ action: 'listing.approve', entityType: 'auditorium', entityId: f.auditoriumId })
        .returning();
      expect(row).toBeDefined();

      expect(
        await sqlState(() =>
          db.update(auditLogs).set({ action: 'tampered' }).where(eq(auditLogs.id, row!.id)),
        ),
      ).toBe('42501');
      expect(await sqlState(() => db.delete(auditLogs).where(eq(auditLogs.id, row!.id)))).toBe(
        '42501',
      );
      expect(await sqlState(() => db.execute(sql`TRUNCATE audit_logs`))).toBe('42501');
    });
  });

  it('maintains updated_at automatically', async () => {
    const [u] = await db
      .insert(users)
      .values({ email: 'ts@example.test', fullName: 'Old' })
      .returning();
    await new Promise((r) => setTimeout(r, 20));
    const [after] = await db
      .update(users)
      .set({ fullName: 'New' })
      .where(eq(users.id, u!.id))
      .returning();
    expect(after!.updatedAt.getTime()).toBeGreaterThan(u!.updatedAt.getTime());
  });
});
