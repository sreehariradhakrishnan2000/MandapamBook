import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  amenities,
  auditLogs,
  cities,
  media,
  ownerProfiles,
  ownerStaff,
  users,
} from '../../../src/db/schema/index.js';
import { hasTestDb } from '../../db-helpers.js';
import {
  Client,
  type Harness,
  PASSWORD,
  createHarness,
  createUser,
  tokenFromEmail,
  uniqueEmail,
} from '../../auth-harness.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const KYC = {
  businessName: 'Lakshmi Mahal Pvt Ltd',
  pan: 'ABCPL1234K',
  gstin: '33ABCPL1234K1Z9',
  bankAccountName: 'Lakshmi Mahal Pvt Ltd',
  bankAccountNumber: '001234567890',
  ifsc: 'HDFC0001234',
};

describe.skipIf(!hasTestDb)('owner listings', () => {
  let h: Harness;
  let cityId: string;

  beforeAll(async () => {
    h = await createHarness();
    const [city] = await h.db
      .insert(cities)
      .values({
        name: 'Madurai',
        slug: `madurai-${randomBytes(3).toString('hex')}`,
        district: 'Madurai',
        state: 'Tamil Nadu',
      })
      .returning();
    cityId = city!.id;
    await h.db
      .insert(amenities)
      .values([
        { code: 'stage_test', name: 'Stage' },
        { code: 'parking_test', name: 'Parking' },
      ])
      .onConflictDoNothing();
  });
  afterAll(async () => {
    await h?.close();
  });

  async function owner(): Promise<{ id: string; c: Client }> {
    const u = await createUser(h.db, 'OWNER');
    const c = new Client(h.app);
    await c.login(u.email);
    return { id: u.id, c };
  }

  const venueBody = (name = `Sri Meenakshi Mahal ${randomBytes(2).toString('hex')}`) => ({
    name,
    cityId,
    addressLine: '12 North Masi Street',
    pincode: '625001',
    cateringPolicy: 'IN_HOUSE_ONLY',
    decorationPolicy: 'OUTSIDE_ALLOWED',
    parkingCars: 40,
    latitude: 9.9252,
    longitude: 78.1198,
  });

  async function createVenue(c: Client) {
    const res = await c.send('post', '/api/v1/owner/auditoriums', venueBody());
    expect(res.status).toBe(201);
    return res.body as { id: string; slug: string; status: string };
  }

  async function uploadPhoto(c: Client, venueId: string, body = PNG_1X1, declared = 'image/png') {
    const res = await c.send('post', `/api/v1/owner/auditoriums/${venueId}/media/upload-url`, {
      mimeType: declared,
      sizeBytes: body.length,
    });
    expect(res.status).toBe(201);
    const key = decodeURIComponent(String(res.body.upload.url).replace('memory://upload/', ''));
    h.storage.put(key, body, declared);
    return { mediaId: res.body.mediaId as string, key };
  }

  describe('owner profile and KYC', () => {
    it('encrypts PAN and bank details and only ever returns masked values', async () => {
      const { id, c } = await owner();
      const res = await c.send('put', '/api/v1/owner/profile', KYC);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        panMasked: 'XXXXXX234K',
        bankAccountMasked: 'XXXXXXXX7890',
        ifsc: 'HDFC0001234',
        kycStatus: 'SUBMITTED',
      });
      // The GSTIN embeds the PAN by design and is public (GST registry); nothing else may.
      const { gstin, ...rest } = res.body as Record<string, unknown>;
      expect(gstin).toBe(KYC.gstin);
      expect(JSON.stringify(rest)).not.toContain('ABCPL1234K');
      expect(JSON.stringify(res.body)).not.toContain('001234567890');

      const [row] = await h.db.select().from(ownerProfiles).where(eq(ownerProfiles.userId, id));
      expect(row!.panEnc!.toString('latin1')).not.toContain('ABCPL1234K');
      expect(row!.bankAccountEnc!.toString('latin1')).not.toContain('001234567890');

      const [event] = await h.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'owner.kyc_updated')));
      expect(
        JSON.stringify({ ...event, after: { ...(event!.after as object), gstin: null } }),
      ).not.toContain('ABCPL1234K');
      expect(JSON.stringify(event)).not.toContain('001234567890');

      const get = await c.send('get', '/api/v1/owner/profile');
      expect(get.body.panMasked).toBe('XXXXXX234K');
      expect(get.headers['cache-control']).toBe('no-store');
    });

    it('rejects a GSTIN that does not contain the PAN', async () => {
      const { c } = await owner();
      const res = await c.send('put', '/api/v1/owner/profile', {
        ...KYC,
        gstin: '33ZZZPL1234K1Z9',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('listing lifecycle', () => {
    it('creates a draft with a slug, edits it with an audited diff, and deletes it', async () => {
      const { c } = await owner();
      const venue = await createVenue(c);
      expect(venue.status).toBe('DRAFT');
      expect(venue.slug).toMatch(/^sri-meenakshi-mahal-[a-f0-9]{4}-madurai/);

      const patch = await c.send('patch', `/api/v1/owner/auditoriums/${venue.id}`, {
        guestRooms: 6,
      });
      expect(patch.body.guestRooms).toBe(6);
      const [event] = await h.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, venue.id), eq(auditLogs.action, 'listing.updated')));
      expect(event).toMatchObject({ before: { guestRooms: 0 }, after: { guestRooms: 6 } });

      expect((await c.send('delete', `/api/v1/owner/auditoriums/${venue.id}`)).status).toBe(204);
      expect((await c.send('get', `/api/v1/owner/auditoriums/${venue.id}`)).status).toBe(404);
    });

    it('rejects unknown cities, half coordinates and owner-supplied status', async () => {
      const { c } = await owner();
      expect(
        (
          await c.send('post', '/api/v1/owner/auditoriums', {
            ...venueBody(),
            cityId: crypto.randomUUID(),
          })
        ).status,
      ).toBe(400);
      const { longitude: _l, ...noLng } = venueBody();
      expect((await c.send('post', '/api/v1/owner/auditoriums', noLng)).status).toBe(400);
      expect(
        (await c.send('post', '/api/v1/owner/auditoriums', { ...venueBody(), status: 'APPROVED' }))
          .status,
      ).toBe(400);
      const venue = await createVenue(c);
      expect(
        (await c.send('patch', `/api/v1/owner/auditoriums/${venue.id}`, { status: 'APPROVED' }))
          .status,
      ).toBe(400);
    });

    it('lists what is missing, then submits a complete listing for review', async () => {
      const { c } = await owner();
      const venue = await createVenue(c);
      const early = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/submit`);
      expect(early.status).toBe(422);
      expect(early.body.error.details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('PAN and bank'),
          'Add at least one hall',
          'Set a cancellation policy',
          expect.stringContaining('at least 3 photos'),
        ]),
      );

      await c.send('put', '/api/v1/owner/profile', KYC);
      const hall = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/halls`, {
        name: 'Main Hall',
        seatingCapacity: 800,
        isAc: true,
      });
      expect(hall.status).toBe(201);
      for (const slot of ['MORNING', 'EVENING', 'FULL_DAY']) {
        const rule = await c.send('post', `/api/v1/owner/halls/${hall.body.id}/pricing-rules`, {
          slot,
          kind: 'BASE',
          pricePaise: 9_500_000,
        });
        expect(rule.status).toBe(201);
      }
      await c.send('put', `/api/v1/owner/auditoriums/${venue.id}/cancellation-policy`, {
        tiers: [
          { minDaysBefore: 30, refundPercent: 75 },
          { minDaysBefore: 0, refundPercent: 0 },
        ],
      });
      for (let i = 0; i < 3; i++) {
        const { mediaId } = await uploadPhoto(c, venue.id);
        expect((await c.send('post', `/api/v1/owner/media/${mediaId}/confirm`)).body.status).toBe(
          'READY',
        );
      }
      await c.send('put', `/api/v1/owner/auditoriums/${venue.id}/amenities`, {
        codes: ['stage_test', 'parking_test'],
      });

      const submit = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/submit`);
      expect(submit.body.error?.details ?? []).toEqual([]);
      expect(submit.status).toBe(200);
      expect(submit.body.status).toBe('PENDING_REVIEW');
      expect((await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/submit`)).status).toBe(
        409,
      );

      const detail = await c.send('get', `/api/v1/owner/auditoriums/${venue.id}`);
      expect(detail.body.halls).toHaveLength(1);
      expect(detail.body.amenities.map((a: { code: string }) => a.code).sort()).toEqual([
        'parking_test',
        'stage_test',
      ]);
      expect(detail.body.cancellationPolicy.tiers[0]).toEqual({
        minDaysBefore: 30,
        refundPercent: 75,
      });
      expect(
        detail.body.photos.every((p: { url: string | null }) =>
          p.url?.startsWith('memory://download/'),
        ),
      ).toBe(true);
      // Only drafts can be deleted.
      expect((await c.send('delete', `/api/v1/owner/auditoriums/${venue.id}`)).status).toBe(409);
    });

    it('keeps one standard price per slot', async () => {
      const { c } = await owner();
      const venue = await createVenue(c);
      const hall = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/halls`, {
        name: 'Hall',
        seatingCapacity: 300,
      });
      await c.send('post', `/api/v1/owner/halls/${hall.body.id}/pricing-rules`, {
        slot: 'MORNING',
        kind: 'BASE',
        pricePaise: 5_000_000,
      });
      await c.send('post', `/api/v1/owner/halls/${hall.body.id}/pricing-rules`, {
        slot: 'MORNING',
        kind: 'BASE',
        pricePaise: 6_000_000,
      });
      await c.send('post', `/api/v1/owner/halls/${hall.body.id}/pricing-rules`, {
        slot: 'MORNING',
        kind: 'SEASONAL',
        validFrom: '2030-04-01',
        validTo: '2030-05-31',
        pricePaise: 7_500_000,
      });
      const rules = (await c.send('get', `/api/v1/owner/halls/${hall.body.id}/pricing-rules`)).body
        .items as { kind: string; pricePaise: number; priority: number }[];
      expect(rules.filter((r) => r.kind === 'BASE')).toEqual([
        expect.objectContaining({ pricePaise: 6_000_000, priority: 0 }),
      ]);
      expect(rules.find((r) => r.kind === 'SEASONAL')?.priority).toBe(20);
    });

    it('refuses duplicate hall names', async () => {
      const { c } = await owner();
      const venue = await createVenue(c);
      await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/halls`, {
        name: 'Annex',
        seatingCapacity: 100,
      });
      const dup = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/halls`, {
        name: 'Annex',
        seatingCapacity: 120,
      });
      expect(dup.status).toBe(409);
    });
  });

  describe('calendar blocks', () => {
    it('blocks dates, rejects overlaps and past dates, and frees the slot on delete', async () => {
      const { c } = await owner();
      const venue = await createVenue(c);
      const hall = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/halls`, {
        name: 'Main',
        seatingCapacity: 500,
      });
      const path = `/api/v1/owner/halls/${hall.body.id}/blocks`;

      const block = await c.send('post', path, {
        eventDate: '2031-01-15',
        slot: 'FULL_DAY',
        reason: 'Painting',
      });
      expect(block.status).toBe(201);
      const clash = await c.send('post', path, { eventDate: '2031-01-15', slot: 'EVENING' });
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(
        (await c.send('post', path, { eventDate: '2020-01-01', slot: 'MORNING' })).status,
      ).toBe(400);

      const cal = await c.send(
        'get',
        `/api/v1/owner/halls/${hall.body.id}/calendar?from=2031-01-01&to=2031-01-31`,
      );
      expect(cal.body.items).toEqual([
        expect.objectContaining({
          eventDate: '2031-01-15',
          slot: 'FULL_DAY',
          kind: 'BLOCK',
          reason: 'Painting',
        }),
      ]);

      expect((await c.send('delete', `/api/v1/owner/blocks/${block.body.id}`)).status).toBe(204);
      expect(
        (await c.send('post', path, { eventDate: '2031-01-15', slot: 'EVENING' })).status,
      ).toBe(201);
    });
  });

  describe('photo uploads', () => {
    it('rejects a file whose bytes are not the declared image type, and deletes it', async () => {
      const { c } = await owner();
      const venue = await createVenue(c);
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      const { mediaId, key } = await uploadPhoto(c, venue.id, html, 'image/png');
      const res = await c.send('post', `/api/v1/owner/media/${mediaId}/confirm`);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_IMAGE');
      expect(h.storage.objects.has(key)).toBe(false);
      const [row] = await h.db.select().from(media).where(eq(media.id, mediaId));
      expect(row!.status).toBe('REJECTED');
    });

    it('rejects a PNG declared as JPEG and an upload whose size changed', async () => {
      const { c } = await owner();
      const venue = await createVenue(c);
      const asJpeg = await uploadPhoto(c, venue.id, PNG_1X1, 'image/jpeg');
      expect((await c.send('post', `/api/v1/owner/media/${asJpeg.mediaId}/confirm`)).status).toBe(
        422,
      );

      const res = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/media/upload-url`, {
        mimeType: 'image/png',
        sizeBytes: 10,
      });
      const key = decodeURIComponent(String(res.body.upload.url).replace('memory://upload/', ''));
      h.storage.put(key, PNG_1X1, 'image/png');
      expect((await c.send('post', `/api/v1/owner/media/${res.body.mediaId}/confirm`)).status).toBe(
        422,
      );
    });

    it('reports a missing upload and refuses unsupported types and oversize files up front', async () => {
      const { c } = await owner();
      const venue = await createVenue(c);
      const res = await c.send('post', `/api/v1/owner/auditoriums/${venue.id}/media/upload-url`, {
        mimeType: 'image/png',
        sizeBytes: 100,
      });
      expect((await c.send('post', `/api/v1/owner/media/${res.body.mediaId}/confirm`)).status).toBe(
        409,
      );
      expect(res.body.upload.headers).toEqual({
        'Content-Type': 'image/png',
        'Content-Length': '100',
      });
      const path = `/api/v1/owner/auditoriums/${venue.id}/media/upload-url`;
      expect(
        (await c.send('post', path, { mimeType: 'image/svg+xml', sizeBytes: 100 })).status,
      ).toBe(400);
      expect(
        (await c.send('post', path, { mimeType: 'image/png', sizeBytes: 11 * 1024 * 1024 })).status,
      ).toBe(400);
    });
  });

  describe('staff', () => {
    it('invites staff who set a password, sees only assigned venues, and is cut off on removal', async () => {
      const { c } = await owner();
      const assigned = await createVenue(c);
      const other = await createVenue(c);
      const email = uniqueEmail('staff');
      const invite = await c.send('post', '/api/v1/owner/staff', {
        email,
        fullName: 'Ravi Kumar',
        auditoriumIds: [assigned.id],
      });
      expect(invite.status).toBe(201);

      const staff = new Client(h.app);
      const token = tokenFromEmail(h.email, email);
      expect(
        (await staff.send('post', '/api/v1/auth/password/reset', { token, password: PASSWORD }))
          .status,
      ).toBe(200);
      expect((await staff.login(email)).status).toBe(200);
      expect(staff.cookies.size).toBeGreaterThan(0);

      const list = await staff.send('get', '/api/v1/owner/auditoriums');
      expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([assigned.id]);
      expect((await staff.send('get', `/api/v1/owner/auditoriums/${other.id}`)).status).toBe(404);

      // Staff may manage the calendar but not pricing, listings, KYC or other staff.
      const hall = await c.send('post', `/api/v1/owner/auditoriums/${assigned.id}/halls`, {
        name: 'Main',
        seatingCapacity: 200,
      });
      expect(
        (
          await staff.send('post', `/api/v1/owner/halls/${hall.body.id}/blocks`, {
            eventDate: '2031-03-03',
            slot: 'MORNING',
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await staff.send('post', `/api/v1/owner/halls/${hall.body.id}/pricing-rules`, {
            slot: 'MORNING',
            kind: 'BASE',
            pricePaise: 100000,
          })
        ).status,
      ).toBe(403);
      expect(
        (await staff.send('patch', `/api/v1/owner/auditoriums/${assigned.id}`, { guestRooms: 1 }))
          .status,
      ).toBe(403);
      expect((await staff.send('get', '/api/v1/owner/profile')).status).toBe(403);
      expect((await staff.send('get', '/api/v1/owner/staff')).status).toBe(403);

      const [u] = await h.db.select().from(users).where(eq(users.email, email));
      expect(u).toMatchObject({ role: 'OWNER_STAFF', status: 'ACTIVE' });
      expect(u!.emailVerifiedAt).not.toBeNull();

      expect((await c.send('delete', `/api/v1/owner/staff/${u!.id}`)).status).toBe(204);
      expect((await staff.send('get', '/api/v1/owner/auditoriums')).status).toBe(401);
      const links = await h.db.select().from(ownerStaff).where(eq(ownerStaff.userId, u!.id));
      expect(links).toHaveLength(0);
    });

    it('never converts an existing account and refuses another owner’s venues', async () => {
      const { c } = await owner();
      const existing = await createUser(h.db, 'CUSTOMER');
      const res = await c.send('post', '/api/v1/owner/staff', {
        email: existing.email,
        fullName: 'Someone',
      });
      expect(res.status).toBe(409);
      const [u] = await h.db.select().from(users).where(eq(users.id, existing.id));
      expect(u!.role).toBe('CUSTOMER');

      const other = await owner();
      const theirVenue = await createVenue(other.c);
      const steal = await c.send('post', '/api/v1/owner/staff', {
        email: uniqueEmail('st'),
        fullName: 'Staff',
        auditoriumIds: [theirVenue.id],
      });
      expect(steal.status).toBe(400);
    });
  });

  describe('IDOR: another owner reaches none of these', () => {
    it('returns 404 on every route for every resource of another owner', async () => {
      const a = await owner();
      const b = await owner();
      const venue = await createVenue(a.c);
      const hall = (
        await a.c.send('post', `/api/v1/owner/auditoriums/${venue.id}/halls`, {
          name: 'Main',
          seatingCapacity: 100,
        })
      ).body.id as string;
      const rule = (
        await a.c.send('post', `/api/v1/owner/halls/${hall}/pricing-rules`, {
          slot: 'MORNING',
          kind: 'BASE',
          pricePaise: 100000,
        })
      ).body.id as string;
      const block = (
        await a.c.send('post', `/api/v1/owner/halls/${hall}/blocks`, {
          eventDate: '2031-06-01',
          slot: 'MORNING',
        })
      ).body.id as string;
      const addon = (
        await a.c.send('post', `/api/v1/owner/auditoriums/${venue.id}/addons`, {
          code: 'sound',
          name: 'Sound',
          pricePaise: 500000,
        })
      ).body.id as string;
      const { mediaId } = await uploadPhoto(a.c, venue.id);

      const attempts: [Parameters<Client['send']>[0], string, object?][] = [
        ['get', `/api/v1/owner/auditoriums/${venue.id}`],
        ['patch', `/api/v1/owner/auditoriums/${venue.id}`, { guestRooms: 99 }],
        ['delete', `/api/v1/owner/auditoriums/${venue.id}`],
        ['post', `/api/v1/owner/auditoriums/${venue.id}/submit`],
        ['put', `/api/v1/owner/auditoriums/${venue.id}/amenities`, { codes: [] }],
        [
          'put',
          `/api/v1/owner/auditoriums/${venue.id}/cancellation-policy`,
          { tiers: [{ minDaysBefore: 0, refundPercent: 100 }] },
        ],
        [
          'post',
          `/api/v1/owner/auditoriums/${venue.id}/halls`,
          { name: 'Evil', seatingCapacity: 1 },
        ],
        [
          'post',
          `/api/v1/owner/auditoriums/${venue.id}/addons`,
          { code: 'evil', name: 'Evil', pricePaise: 1 },
        ],
        [
          'post',
          `/api/v1/owner/auditoriums/${venue.id}/media/upload-url`,
          { mimeType: 'image/png', sizeBytes: 10 },
        ],
        ['patch', `/api/v1/owner/halls/${hall}`, { seatingCapacity: 1 }],
        ['delete', `/api/v1/owner/halls/${hall}`],
        ['get', `/api/v1/owner/halls/${hall}/pricing-rules`],
        [
          'post',
          `/api/v1/owner/halls/${hall}/pricing-rules`,
          { slot: 'EVENING', kind: 'BASE', pricePaise: 100 },
        ],
        ['delete', `/api/v1/owner/pricing-rules/${rule}`],
        ['get', `/api/v1/owner/halls/${hall}/calendar?from=2031-01-01&to=2031-12-31`],
        [
          'post',
          `/api/v1/owner/halls/${hall}/blocks`,
          { eventDate: '2031-06-02', slot: 'MORNING' },
        ],
        ['delete', `/api/v1/owner/blocks/${block}`],
        ['patch', `/api/v1/owner/addons/${addon}`, { pricePaise: 1 }],
        ['delete', `/api/v1/owner/addons/${addon}`],
        ['post', `/api/v1/owner/media/${mediaId}/confirm`],
        ['patch', `/api/v1/owner/media/${mediaId}`, { altText: 'pwned' }],
        ['delete', `/api/v1/owner/media/${mediaId}`],
      ];
      for (const [method, path, body] of attempts) {
        const res = await b.c.send(method, path, body);
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
      }

      // Nothing changed for owner A.
      const detail = await a.c.send('get', `/api/v1/owner/auditoriums/${venue.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.guestRooms).toBe(0);
      expect(detail.body.halls).toHaveLength(1);
      expect(detail.body.addons[0].pricePaise).toBe(500000);
    });

    it('denies customers on every owner route', async () => {
      const cust = new Client(h.app);
      await cust.login((await createUser(h.db, 'CUSTOMER')).email);
      for (const [method, path] of [
        ['get', '/api/v1/owner/profile'],
        ['post', '/api/v1/owner/auditoriums'],
        ['get', '/api/v1/owner/staff'],
      ] as const) {
        expect((await cust.send(method, path, {})).status).toBe(403);
      }
    });
  });
});
