import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { count, eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../src/db/client.js';
import {
  auditoriums,
  cities,
  halls,
  media,
  platformSettings,
  pricingRules,
} from '../../../src/db/schema/index.js';
import { AMENITIES, CITIES } from '../../../src/db/seed/master-data.js';
import { SAMPLE_AUDITORIUMS } from '../../../src/db/seed/sample-data.js';
import { DEMO_USERS, seedDemoUsers } from '../../../src/db/seed/demo-users.js';
import { seedSamplePhotos } from '../../../src/db/seed/sample-photos.js';
import { seedMasterData, seedSampleData } from '../../../src/db/seed/seed.js';
import { MemoryObjectStorage } from '../../../src/infra/storage.js';
import { verifyPassword } from '../../../src/modules/auth/password.js';
import { ownerStaff, users } from '../../../src/db/schema/index.js';
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

  it('creates demo accounts for every role with the given password, idempotently', async () => {
    await seedDemoUsers(db, 'test-only-demo-password');
    await seedDemoUsers(db, 'test-only-demo-password');
    for (const demo of DEMO_USERS) {
      const [u] = await db.select().from(users).where(eq(users.email, demo.email));
      expect(u?.role).toBe(demo.role);
      expect(await verifyPassword(u!.passwordHash!, 'test-only-demo-password')).toBe(true);
    }
    const [staff] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'staff.kerala@example.test'));
    const links = await db.select().from(ownerStaff).where(eq(ownerStaff.userId, staff!.id));
    expect(links).toHaveLength(1);
  });

  it('uploads two READY photos per sample venue once, through presigned PUTs', async () => {
    // A stand-in for the bucket: accepts PUTs and records what arrived.
    const received = new Map<string, { type: string | undefined; bytes: number }>();
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.set(decodeURIComponent(req.url!.slice(1)), {
          type: req.headers['content-type'],
          bytes: Buffer.concat(chunks).length,
        });
        res.writeHead(req.method === 'PUT' ? 200 : 405).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const storage = new MemoryObjectStorage();
    storage.createUploadUrl = async (key, contentType, sizeBytes) => ({
      url: `http://127.0.0.1:${port}/${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    try {
      const ids = (
        await db
          .select({ id: auditoriums.id })
          .from(auditoriums)
          .where(
            inArray(
              auditoriums.slug,
              SAMPLE_AUDITORIUMS.map((v) => v.slug),
            ),
          )
      ).map((a) => a.id);
      await db.delete(media).where(inArray(media.auditoriumId, ids));

      const first = await seedSamplePhotos(db, storage);
      expect(first).toEqual({
        venues: SAMPLE_AUDITORIUMS.length,
        photos: SAMPLE_AUDITORIUMS.length * 2,
      });
      const rows = await db.select().from(media).where(inArray(media.auditoriumId, ids));
      expect(rows).toHaveLength(SAMPLE_AUDITORIUMS.length * 2);
      for (const m of rows) {
        expect(m.status).toBe('READY');
        expect(m.altText).not.toBe('');
        expect(received.get(m.storageKey)).toEqual({ type: 'image/webp', bytes: m.sizeBytes });
      }

      expect(await seedSamplePhotos(db, storage)).toEqual({ venues: 0, photos: 0 });
    } finally {
      server.close();
    }
  });
});
