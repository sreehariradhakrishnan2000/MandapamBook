import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  auditoriums,
  cities,
  halls,
  ownerStaff,
  users,
} from '../../../src/db/schema/index.js';
import { hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

describe.skipIf(!hasTestDb)('RBAC and ownership (IDOR)', () => {
  let h: Harness;
  let ownerA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let venueA1: string;
  let venueA2: string;
  let venueB: string;

  async function venue(ownerId: string, name: string): Promise<string> {
    const [city] = await h.db.select().from(cities).limit(1);
    const cityId =
      city?.id ??
      (
        await h.db
          .insert(cities)
          .values({
            name: 'Kochi',
            slug: `kochi-${Date.now()}`,
            district: 'Ernakulam',
            state: 'Kerala',
          })
          .returning()
      )[0]!.id;
    const [row] = await h.db
      .insert(auditoriums)
      .values({
        ownerId,
        cityId,
        name,
        slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomBytes(3).toString('hex')}`,
        addressLine: '1 Road',
        pincode: '682001',
        cateringPolicy: 'OUTSIDE_ALLOWED',
        decorationPolicy: 'OUTSIDE_ALLOWED',
      })
      .returning();
    await h.db.insert(halls).values({ auditoriumId: row!.id, name: 'Main', seatingCapacity: 300 });
    return row!.id;
  }

  async function signedIn(user: { email: string }): Promise<Client> {
    const c = new Client(h.app);
    const res = await c.login(user.email);
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    return c;
  }

  beforeAll(async () => {
    h = await createHarness();
    ownerA = await createUser(h.db, 'OWNER');
    ownerB = await createUser(h.db, 'OWNER');
    venueA1 = await venue(ownerA.id, 'A One Mandapam');
    venueA2 = await venue(ownerA.id, 'A Two Hall');
    venueB = await venue(ownerB.id, 'B Convention');
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('owner isolation', () => {
    it('lists only the caller’s own venues', async () => {
      const a = await signedIn(ownerA);
      const res = await a.send('get', '/api/v1/owner/auditoriums');
      expect(res.status).toBe(200);
      const ids = (res.body.items as { id: string }[]).map((v) => v.id).sort();
      expect(ids).toEqual([venueA1, venueA2].sort());
    });

    it('returns 404, not 403, for another owner’s venue', async () => {
      const a = await signedIn(ownerA);
      const res = await a.send('get', `/api/v1/owner/auditoriums/${venueB}`);
      expect(res.status).toBe(404);
      const own = await a.send('get', `/api/v1/owner/auditoriums/${venueA1}`);
      expect(own.status).toBe(200);
      expect(own.body.halls).toHaveLength(1);
    });

    it('treats malformed ids as not found', async () => {
      const a = await signedIn(ownerA);
      expect((await a.send('get', "/api/v1/owner/auditoriums/1' OR '1'='1")).status).toBe(404);
    });

    it('limits staff to their owner, and to assigned venues when set', async () => {
      const staff = await createUser(h.db, 'OWNER_STAFF');
      await h.db
        .insert(ownerStaff)
        .values({ ownerId: ownerA.id, userId: staff.id, auditoriumIds: [venueA2] });
      const s = await signedIn(staff);
      const list = await s.send('get', '/api/v1/owner/auditoriums');
      expect((list.body.items as { id: string }[]).map((v) => v.id)).toEqual([venueA2]);
      expect((await s.send('get', `/api/v1/owner/auditoriums/${venueA1}`)).status).toBe(404);
      expect((await s.send('get', `/api/v1/owner/auditoriums/${venueB}`)).status).toBe(404);
    });

    it('denies staff whose link to an owner was removed', async () => {
      const orphan = await createUser(h.db, 'OWNER_STAFF');
      const s = await signedIn(orphan);
      expect((await s.send('get', '/api/v1/owner/auditoriums')).status).toBe(403);
    });

    it('denies customers and admins on owner routes', async () => {
      const customer = await signedIn(await createUser(h.db, 'CUSTOMER'));
      expect((await customer.send('get', '/api/v1/owner/auditoriums')).status).toBe(403);
      const admin = await signedIn(await createUser(h.db, 'ADMIN'));
      expect((await admin.send('get', '/api/v1/owner/auditoriums')).status).toBe(403);
    });
  });

  describe('permissions on admin routes', () => {
    it('requires authentication', async () => {
      const res = await new Client(h.app).send('get', '/api/v1/admin/audit-logs');
      expect(res.status).toBe(401);
    });

    it('lets admins read the audit log but not customers or owners', async () => {
      const admin = await signedIn(await createUser(h.db, 'ADMIN'));
      expect((await admin.send('get', '/api/v1/admin/audit-logs?limit=5')).status).toBe(200);
      for (const role of ['CUSTOMER', 'OWNER', 'OWNER_STAFF'] as const) {
        const c = await signedIn(await createUser(h.db, role));
        expect((await c.send('get', '/api/v1/admin/audit-logs')).status).toBe(403);
      }
    });

    it('reserves role changes for super admins', async () => {
      const target = await createUser(h.db, 'CUSTOMER');
      const admin = await signedIn(await createUser(h.db, 'ADMIN'));
      const res = await admin.send('patch', `/api/v1/admin/users/${target.id}/role`, {
        role: 'ADMIN',
      });
      expect(res.status).toBe(403);
    });

    it('audits a role change and immediately invalidates the target’s tokens', async () => {
      const superAdmin = await createUser(h.db, 'SUPER_ADMIN');
      const target = await createUser(h.db, 'CUSTOMER');
      const targetClient = await signedIn(target);
      const sa = await signedIn(superAdmin);

      const res = await sa.send('patch', `/api/v1/admin/users/${target.id}/role`, {
        role: 'ADMIN',
      });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');

      // The old token still says CUSTOMER; it must no longer be accepted.
      expect((await targetClient.send('get', '/api/v1/auth/me')).status).toBe(401);
      expect((await targetClient.refresh()).status).toBe(401);

      const [event] = await h.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, target.id), eq(auditLogs.action, 'user.role_changed')));
      expect(event).toMatchObject({
        actorId: superAdmin.id,
        actorRole: 'SUPER_ADMIN',
        before: { role: 'CUSTOMER' },
        after: { role: 'ADMIN' },
      });
      expect(event!.ip).toBeTruthy();
    });

    it('forbids changing your own role', async () => {
      const superAdmin = await createUser(h.db, 'SUPER_ADMIN');
      const sa = await signedIn(superAdmin);
      const res = await sa.send('patch', `/api/v1/admin/users/${superAdmin.id}/role`, {
        role: 'CUSTOMER',
      });
      expect(res.status).toBe(403);
    });

    it('does not let an admin suspend a super admin', async () => {
      const superAdmin = await createUser(h.db, 'SUPER_ADMIN');
      const admin = await signedIn(await createUser(h.db, 'ADMIN'));
      const res = await admin.send('patch', `/api/v1/admin/users/${superAdmin.id}/status`, {
        status: 'SUSPENDED',
        reason: 'testing escalation',
      });
      expect(res.status).toBe(403);
    });

    it('suspending a user ends their sessions', async () => {
      const target = await createUser(h.db, 'CUSTOMER');
      const t = await signedIn(target);
      const admin = await signedIn(await createUser(h.db, 'ADMIN'));
      const res = await admin.send('patch', `/api/v1/admin/users/${target.id}/status`, {
        status: 'SUSPENDED',
        reason: 'fraud report',
      });
      expect(res.status).toBe(204);
      expect((await t.send('get', '/api/v1/auth/me')).status).toBe(401);
      const [row] = await h.db.select().from(users).where(eq(users.id, target.id));
      expect(row!.status).toBe('SUSPENDED');
    });
  });

  describe('token tampering', () => {
    it('rejects tokens signed with another key, with alg=none, or with a forged role', async () => {
      const customer = await createUser(h.db, 'CUSTOMER');
      const c = await signedIn(customer);
      const [header, payload, signature] = c.accessToken!.split('.');

      const elevated = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
          role: 'SUPER_ADMIN',
        }),
      ).toString('base64url');
      const forgedRole = `${header}.${elevated}.${signature}`;
      expect(
        (await c.send('get', '/api/v1/admin/audit-logs', undefined, { bearer: forgedRole })).status,
      ).toBe(401);

      const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt', kid: 'a1' })).toString('base64url')}.${elevated}.`;
      expect((await c.send('get', '/api/v1/auth/me', undefined, { bearer: none })).status).toBe(
        401,
      );

      const otherKey = await new SignJWT({ role: 'SUPER_ADMIN', sid: 'x' })
        .setProtectedHeader({ alg: 'HS256', kid: 'a1', typ: 'at+jwt' })
        .setSubject(customer.id)
        .setIssuer('mandapambook')
        .setAudience('mandapambook-api')
        .setJti('j')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(randomBytes(32));
      expect((await c.send('get', '/api/v1/auth/me', undefined, { bearer: otherKey })).status).toBe(
        401,
      );
    });
  });
});
