import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, auditoriums, cities, users } from '../../../src/db/schema/index.js';
import { hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const KYC = {
  businessName: 'Hegde Convention Services',
  pan: 'ABCPH5678Q',
  bankAccountName: 'Hegde Convention Services',
  bankAccountNumber: '987654321012',
  ifsc: 'CNRB0004321',
};

// Each test drives many API calls; allow for remote-database latency.
describe.skipIf(!hasTestDb)('admin review', { timeout: 120_000 }, () => {
  let h: Harness;
  let cityId: string;
  let admin: Client;
  let superAdmin: Client;
  let adminId: string;

  async function signIn(role: Parameters<typeof createUser>[1]) {
    const u = await createUser(h.db, role);
    const c = new Client(h.app);
    await c.login(u.email);
    return { ...u, c };
  }

  /** An owner with KYC submitted and a complete listing in PENDING_REVIEW. */
  async function pendingListing() {
    const owner = await signIn('OWNER');
    const c = owner.c;
    await c.send('put', '/api/v1/owner/profile', KYC);
    const venue = (
      await c.send('post', '/api/v1/owner/auditoriums', {
        name: `Basavanagudi Mantapa ${randomBytes(2).toString('hex')}`,
        cityId,
        addressLine: '7 Bull Temple Road',
        pincode: '560004',
        cateringPolicy: 'OUTSIDE_ALLOWED',
        decorationPolicy: 'IN_HOUSE_ONLY',
      })
    ).body as { id: string; name: string };
    const hall = (
      await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/halls`, {
        name: 'Mantapa',
        seatingCapacity: 900,
      })
    ).body as { id: string };
    for (const slot of ['MORNING', 'EVENING', 'FULL_DAY']) {
      await c.send('post', `/api/v1/owner/halls/${hall.id}/pricing-rules`, {
        slot,
        kind: 'BASE',
        pricePaise: 9_000_000,
      });
    }
    await c.send('put', `/api/v1/owner/auditoriums/${venue.id}/cancellation-policy`, {
      tiers: [{ minDaysBefore: 0, refundPercent: 0 }],
    });
    for (let i = 0; i < 3; i++) {
      const up = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/media/upload-url`, {
        mimeType: 'image/png',
        sizeBytes: PNG.length,
      });
      h.storage.put(
        decodeURIComponent(String(up.body.upload.url).replace('memory://upload/', '')),
        PNG,
        'image/png',
      );
      await c.send('post', `/api/v1/owner/media/${up.body.mediaId}/confirm`);
    }
    const submitted = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/submit`);
    expect(submitted.status).toBe(200);
    return { owner, venue };
  }

  beforeAll(async () => {
    h = await createHarness();
    const [city] = await h.db
      .insert(cities)
      .values({
        name: 'Bengaluru',
        slug: `bengaluru-${randomBytes(3).toString('hex')}`,
        district: 'Bengaluru Urban',
        state: 'Karnataka',
      })
      .returning();
    cityId = city!.id;
    const a = await signIn('ADMIN');
    admin = a.c;
    adminId = a.id;
    superAdmin = (await signIn('SUPER_ADMIN')).c;
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('KYC review', () => {
    it('lists submitted owners with masked values only', async () => {
      const { owner } = await pendingListing();
      const res = await admin.send('get', '/api/v1/admin/owners?kycStatus=SUBMITTED&limit=100');
      expect(res.status).toBe(200);
      const row = (res.body.items as { ownerId: string; panMasked: string }[]).find(
        (i) => i.ownerId === owner.id,
      );
      expect(row?.panMasked).toBe('XXXXXX678Q');
      expect(JSON.stringify(res.body)).not.toContain('ABCPH5678Q');
      expect(JSON.stringify(res.body)).not.toContain('987654321012');
    });

    it('reveals full numbers only with a purpose, and audits every reveal', async () => {
      const { owner } = await pendingListing();
      const path = `/api/v1/admin/owners/${owner.id}/kyc/reveal`;
      expect((await admin.send('post', path, {})).status).toBe(400);
      const res = await admin.send('post', path, { purpose: 'Match PAN card upload' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        pan: 'ABCPH5678Q',
        bankAccountNumber: '987654321012',
        ifsc: 'CNRB0004321',
      });
      expect(res.headers['cache-control']).toBe('no-store');
      const [event] = await h.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, owner.id), eq(auditLogs.action, 'owner.kyc_revealed')));
      expect(event).toMatchObject({
        actorId: adminId,
        after: { purpose: 'Match PAN card upload' },
      });

      const customer = await signIn('CUSTOMER');
      expect((await customer.c.send('post', path, { purpose: 'curious about it' })).status).toBe(
        403,
      );
      expect((await owner.c.send('post', path, { purpose: 'my own details' })).status).toBe(403);
    });

    it('verifies or rejects with a reason, notifies the owner, and refuses double decisions', async () => {
      const { owner } = await pendingListing();
      const path = `/api/v1/admin/owners/${owner.id}/kyc/decision`;
      expect((await admin.send('post', path, { decision: 'reject', reason: 'short' })).status).toBe(
        400,
      );
      const rejected = await admin.send('post', path, {
        decision: 'reject',
        reason: 'Account holder name does not match PAN',
      });
      expect(rejected.body).toMatchObject({
        kycStatus: 'REJECTED',
        kycRejectionReason: 'Account holder name does not match PAN',
      });
      expect(h.email.lastTo(owner.email)?.template).toBe('kyc_decision');
      expect((await admin.send('post', path, { decision: 'verify' })).status).toBe(409);

      // Resubmitting clears the reason and allows review again.
      const resubmitted = await owner.c.send('put', '/api/v1/owner/profile', KYC);
      expect(resubmitted.body).toMatchObject({ kycStatus: 'SUBMITTED', kycRejectionReason: null });
      expect((await admin.send('post', path, { decision: 'verify' })).body.kycStatus).toBe(
        'VERIFIED',
      );
    });
  });

  describe('listing approval', () => {
    it('will not approve before KYC is verified', async () => {
      const { venue } = await pendingListing();
      const res = await admin.send('post', `/api/v1/admin/listings/${venue.id}/decision`, {
        decision: 'approve',
      });
      expect(res.status).toBe(422);
      expect(res.body.error.details).toContain("Verify the owner's KYC first");
    });

    it('approves, audits and notifies; then suspends, locks edits and reinstates', async () => {
      const { owner, venue } = await pendingListing();
      await admin.send('post', `/api/v1/admin/owners/${owner.id}/kyc/decision`, {
        decision: 'verify',
      });

      const queue = await admin.send(
        'get',
        `/api/v1/admin/listings?status=PENDING_REVIEW&q=${encodeURIComponent(venue.name)}`,
      );
      expect(queue.body.items.map((i: { id: string }) => i.id)).toEqual([venue.id]);
      const detail = await admin.send('get', `/api/v1/admin/listings/${venue.id}`);
      expect(detail.body.gaps).toEqual([]);
      expect(detail.body.photos).toHaveLength(3);
      expect(detail.body.halls[0].pricingRules).toHaveLength(3);
      expect(detail.body.owner.email).toBe(owner.email);

      const approve = await admin.send('post', `/api/v1/admin/listings/${venue.id}/decision`, {
        decision: 'approve',
      });
      expect(approve.body.status).toBe('APPROVED');
      expect(h.email.lastTo(owner.email)?.subject).toContain('approved');
      const [event] = await h.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, venue.id), eq(auditLogs.action, 'listing.approved')));
      expect(event).toMatchObject({
        actorId: adminId,
        before: { status: 'PENDING_REVIEW' },
        after: { status: 'APPROVED' },
      });
      expect(
        (
          await admin.send('post', `/api/v1/admin/listings/${venue.id}/decision`, {
            decision: 'approve',
          })
        ).status,
      ).toBe(409);

      const suspend = await admin.send('post', `/api/v1/admin/listings/${venue.id}/decision`, {
        decision: 'suspend',
        reason: 'Multiple customer complaints about overbooking',
      });
      expect(suspend.body.status).toBe('SUSPENDED');
      const edit = await owner.c.send('patch', `/api/v1/owner/auditoriums/${venue.id}`, {
        guestRooms: 2,
      });
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('LISTING_LOCKED');

      expect(
        (
          await admin.send('post', `/api/v1/admin/listings/${venue.id}/decision`, {
            decision: 'reinstate',
          })
        ).body.status,
      ).toBe('APPROVED');
    });

    it('rejects with feedback the owner can act on, then accepts a resubmission', async () => {
      const { owner, venue } = await pendingListing();
      const reason = 'Please add photos of the dining hall and stage';
      const res = await admin.send('post', `/api/v1/admin/listings/${venue.id}/decision`, {
        decision: 'reject',
        reason,
      });
      expect(res.body).toMatchObject({ status: 'REJECTED', rejectionReason: reason });
      const mine = await owner.c.send('get', `/api/v1/owner/auditoriums/${venue.id}`);
      expect(mine.body.rejectionReason).toBe(reason);
      const resubmit = await owner.c.send('post', `/api/v1/owner/auditoriums/${venue.id}/submit`);
      expect(resubmit.body).toMatchObject({ status: 'PENDING_REVIEW', rejectionReason: null });
    });

    it('lets only one of two simultaneous decisions win', async () => {
      const { owner, venue } = await pendingListing();
      await admin.send('post', `/api/v1/admin/owners/${owner.id}/kyc/decision`, {
        decision: 'verify',
      });
      const path = `/api/v1/admin/listings/${venue.id}/decision`;
      const [a, b] = await Promise.all([
        admin.send('post', path, { decision: 'approve' }),
        superAdmin.send('post', path, {
          decision: 'reject',
          reason: 'Duplicate of an existing listing',
        }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const [row] = await h.db.select().from(auditoriums).where(eq(auditoriums.id, venue.id));
      expect(['APPROVED', 'REJECTED']).toContain(row!.status);
    });

    it('is closed to owners and customers', async () => {
      const { owner, venue } = await pendingListing();
      expect(
        (
          await owner.c.send('post', `/api/v1/admin/listings/${venue.id}/decision`, {
            decision: 'approve',
          })
        ).status,
      ).toBe(403);
      expect((await owner.c.send('get', '/api/v1/admin/listings')).status).toBe(403);
      expect(
        (await admin.send('get', `/api/v1/admin/listings/${crypto.randomUUID()}`)).status,
      ).toBe(404);
    });
  });

  describe('users', () => {
    it('searches users without exposing password hashes, treating wildcards literally', async () => {
      const u = await createUser(h.db, 'CUSTOMER', { fullName: 'Anjali 100% Nair' });
      const res = await admin.send('get', `/api/v1/admin/users?q=${encodeURIComponent('100%')}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([u.id]);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
      const detail = await admin.send('get', `/api/v1/admin/users/${u.id}`);
      expect(detail.body).toMatchObject({ email: u.email, role: 'CUSTOMER' });
      expect(detail.body.passwordHash).toBeUndefined();
    });

    it('marks an email as verified, activates the account, and audits it once', async () => {
      const u = await createUser(h.db, 'CUSTOMER', {
        status: 'PENDING_VERIFICATION',
        emailVerifiedAt: null,
      });
      const path = `/api/v1/admin/users/${u.id}/verify-email`;
      const res = await admin.send('post', path);
      expect(res.status).toBe(200);
      expect(res.body.emailVerifiedAt).toBeTruthy();
      const [row] = await h.db.select().from(users).where(eq(users.id, u.id));
      expect(row).toMatchObject({ status: 'ACTIVE' });
      expect(row!.emailVerifiedAt).not.toBeNull();

      // Repeating it changes nothing and adds no second audit entry.
      expect((await admin.send('post', path)).status).toBe(200);
      const logs = await h.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.entityId, u.id), eq(auditLogs.action, 'user.email_marked_verified')),
        );
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorId: adminId });
    });

    it('lets only super admins verify an admin, and keeps customers out', async () => {
      const other = await createUser(h.db, 'ADMIN', { emailVerifiedAt: null });
      const path = `/api/v1/admin/users/${other.id}/verify-email`;
      expect((await admin.send('post', path)).status).toBe(403);
      expect((await superAdmin.send('post', path)).status).toBe(200);
      const customer = await signIn('CUSTOMER');
      expect((await customer.c.send('post', path)).status).toBe(403);
      expect(
        (
          await admin.send(
            'post',
            '/api/v1/admin/users/00000000-0000-4000-8000-000000000000/verify-email',
          )
        ).status,
      ).toBe(404);
    });
  });

  describe('master data and settings', () => {
    it('manages cities, amenities and muhurtham dates with audit and clear conflicts', async () => {
      const slug = `alappuzha-${randomBytes(2).toString('hex')}`;
      const city = await admin.send('post', '/api/v1/admin/cities', {
        name: 'Alappuzha',
        slug,
        district: 'Alappuzha',
        state: 'Kerala',
        nameI18n: { ml: 'ആലപ്പുഴ' },
      });
      expect(city.status).toBe(201);
      expect(
        (
          await admin.send('post', '/api/v1/admin/cities', {
            name: 'Duplicate',
            slug,
            district: 'Alappuzha',
            state: 'Kerala',
          })
        ).status,
      ).toBe(409);
      const off = await admin.send('patch', `/api/v1/admin/cities/${city.body.id}`, {
        isActive: false,
      });
      expect(off.body.isActive).toBe(false);
      const publicList = await new Client(h.app).send('get', '/api/v1/cities');
      expect(publicList.body.items.some((c: { slug: string }) => c.slug === slug)).toBe(false);

      const code = `pool_${randomBytes(2).toString('hex')}`;
      expect(
        (await admin.send('post', '/api/v1/admin/amenities', { code, name: 'Swimming pool' }))
          .status,
      ).toBe(201);
      expect(
        (await admin.send('post', '/api/v1/admin/amenities', { code: 'Bad Code', name: 'x' }))
          .status,
      ).toBe(400);

      expect(
        (
          await admin.send('post', '/api/v1/admin/muhurtham-dates', {
            date: '2031-02-14',
            label: 'Vasant Panchami',
          })
        ).status,
      ).toBe(201);
      expect(
        (await admin.send('post', '/api/v1/admin/muhurtham-dates', { date: '2031-02-14' })).status,
      ).toBe(409);
      expect((await admin.send('delete', '/api/v1/admin/muhurtham-dates/2031-02-14')).status).toBe(
        204,
      );

      const events = await h.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'masterdata.changed'));
      expect(events.length).toBeGreaterThanOrEqual(4);

      const customer = await signIn('CUSTOMER');
      expect(
        (
          await customer.c.send('post', '/api/v1/admin/cities', {
            name: 'X',
            slug: 'x',
            district: 'X',
            state: 'X',
          })
        ).status,
      ).toBe(403);
    });

    it('lets admins read settings but only super admins change them, with an audited diff', async () => {
      const current = await admin.send('get', '/api/v1/admin/settings');
      expect(current.body).toMatchObject({
        gst_bps: expect.any(Number),
        commission_bps: expect.any(Number),
      });
      expect(
        (await admin.send('put', '/api/v1/admin/settings', { commission_bps: 900 })).status,
      ).toBe(403);
      expect(
        (await superAdmin.send('put', '/api/v1/admin/settings', { commission_bps: 99999 })).status,
      ).toBe(400);
      const changed = await superAdmin.send('put', '/api/v1/admin/settings', {
        commission_bps: 900,
      });
      expect(changed.status).toBe(200);
      expect(changed.body.commission_bps).toBe(900);
      expect(changed.body.gst_bps).toBe(current.body.gst_bps);
      const [event] = await h.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'settings.changed'));
      expect(event).toMatchObject({
        before: { commission_bps: current.body.commission_bps },
        after: { commission_bps: 900 },
      });
    });
  });
  describe('maintenance switch', () => {
    // Only ever saved as OFF here: the test database is shared by test files running at
    // the same time, and turning maintenance on would close it for them. The gate itself
    // is covered by test/unit/maintenance.test.ts.
    it('lets only super admins change it, validates it, audits it, and reports it publicly', async () => {
      const body = { enabled: false, message: '  Back soon  ', until: null };
      const customer = await signIn('CUSTOMER');
      expect((await customer.c.send('put', '/api/v1/admin/maintenance', body)).status).toBe(403);
      expect((await admin.send('put', '/api/v1/admin/maintenance', body)).status).toBe(403);
      expect(
        (await superAdmin.send('put', '/api/v1/admin/maintenance', { enabled: 'yes' })).status,
      ).toBe(400);
      expect(
        (await superAdmin.send('put', '/api/v1/admin/maintenance', { ...body, until: 'soon' }))
          .status,
      ).toBe(400);

      // A scheduled window needs both ends, in the right order.
      const from = '2030-01-09T23:00:00+05:30';
      const to = '2030-01-10T00:00:00+05:30';
      for (const bad of [
        { scheduledFrom: from, scheduledTo: null },
        { scheduledFrom: to, scheduledTo: from },
      ])
        expect(
          (await superAdmin.send('put', '/api/v1/admin/maintenance', { ...body, ...bad })).status,
        ).toBe(400);

      const saved = await superAdmin.send('put', '/api/v1/admin/maintenance', {
        ...body,
        scheduledFrom: from,
        scheduledTo: to,
      });
      expect(saved.status).toBe(200);
      const expected = {
        enabled: false,
        message: 'Back soon',
        until: null,
        scheduledFrom: from,
        scheduledTo: to,
      };
      expect(saved.body).toEqual(expected);

      const status = await new Client(h.app).send('get', '/api/v1/status');
      expect(status.status).toBe(200);
      expect(status.headers['cache-control']).toBe('no-store');
      expect(status.body.maintenance).toEqual(expected);

      const logs = await h.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'settings.maintenance_changed'));
      expect(logs.length).toBeGreaterThan(0);
      // Clear the notice so the shared staging-like state stays clean.
      await superAdmin.send('put', '/api/v1/admin/maintenance', { enabled: false });
    });

    it('lets only super admins pause bookings, and audits it', async () => {
      // Saved as not paused only, for the same reason as maintenance.
      const body = { paused: false, message: '  Razorpay is down  ' };
      expect((await admin.send('put', '/api/v1/admin/bookings-pause', body)).status).toBe(403);
      expect(
        (await superAdmin.send('put', '/api/v1/admin/bookings-pause', { paused: 1 })).status,
      ).toBe(400);
      const saved = await superAdmin.send('put', '/api/v1/admin/bookings-pause', body);
      expect(saved.body).toEqual({ paused: false, message: 'Razorpay is down' });
      const status = await new Client(h.app).send('get', '/api/v1/status');
      expect(status.body.bookings).toEqual({ paused: false, message: 'Razorpay is down' });
      const logs = await h.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'settings.bookings_pause_changed'));
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
