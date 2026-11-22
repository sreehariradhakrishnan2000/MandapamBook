import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  addonSchema,
  addonUpdateSchema,
  amenitiesSchema,
  auditoriumSchema,
  auditoriumUpdateSchema,
  cancellationPolicySchema,
  hallSchema,
  hallUpdateSchema,
} from '@mandapambook/shared';
import { type Db, PG_ERROR, pgErrorCode } from '../../db/client.js';
import {
  addons,
  amenities,
  auditoriumAmenities,
  auditoriums,
  bookings,
  cancellationPolicies,
  cities,
  halls,
  media,
  ownerProfiles,
  pricingRules,
} from '../../db/schema/index.js';
import { HttpError, errors } from '../../http/errors.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { auditoriumScopeCondition } from '../rbac/owner-scope.js';
import { type ScopedResources, requireOwner } from './scoped.js';

const EDITABLE_STATUSES = ['DRAFT', 'REJECTED', 'PENDING_REVIEW', 'APPROVED'] as const;
const DOWNLOAD_URL_TTL = 300;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // drop accents split off by NFKD; other scripts become dashes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export interface ListingsDeps {
  db: Db;
  scoped: ScopedResources;
  audit: AuditService;
  storage: ObjectStorage;
}

export function listingsRouter({ db, scoped, audit, storage }: ListingsDeps): Router {
  const r = Router();

  const summary = {
    id: auditoriums.id,
    name: auditoriums.name,
    slug: auditoriums.slug,
    status: auditoriums.status,
    cityId: auditoriums.cityId,
    rejectionReason: auditoriums.rejectionReason,
    updatedAt: auditoriums.updatedAt,
  };

  // ------------------------------------------------------------ venues

  r.get('/auditoriums', requirePermission('booking:view_venue'), async (req, res) => {
    const scope = await scoped.scope(req);
    const items = await db
      .select(summary)
      .from(auditoriums)
      .where(auditoriumScopeCondition(scope))
      .orderBy(asc(auditoriums.name));
    res.json({ items });
  });

  r.get('/auditoriums/:id', requirePermission('booking:view_venue'), async (req, res) => {
    const scope = await scoped.scope(req);
    const venue = await scoped.auditorium(scope, req.params['id']);
    const [hallRows, amenityRows, addonRows, policy, mediaRows] = await Promise.all([
      db.select().from(halls).where(eq(halls.auditoriumId, venue.id)).orderBy(asc(halls.name)),
      db
        .select({ code: amenities.code, name: amenities.name })
        .from(auditoriumAmenities)
        .innerJoin(amenities, eq(amenities.id, auditoriumAmenities.amenityId))
        .where(eq(auditoriumAmenities.auditoriumId, venue.id)),
      db.select().from(addons).where(eq(addons.auditoriumId, venue.id)).orderBy(asc(addons.name)),
      db.select().from(cancellationPolicies).where(eq(cancellationPolicies.auditoriumId, venue.id)),
      db
        .select()
        .from(media)
        .where(and(eq(media.auditoriumId, venue.id), ne(media.status, 'REJECTED')))
        .orderBy(asc(media.sortOrder), asc(media.createdAt)),
    ]);
    const photos = await Promise.all(
      mediaRows.map(async (m) => ({
        id: m.id,
        status: m.status,
        altText: m.altText,
        sortOrder: m.sortOrder,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        url:
          m.status === 'READY'
            ? await storage.createDownloadUrl(m.storageKey, DOWNLOAD_URL_TTL)
            : null,
      })),
    );
    res.set('Cache-Control', 'private, no-store').json({
      ...venue,
      halls: hallRows,
      amenities: amenityRows,
      addons: addonRows,
      cancellationPolicy: policy[0] ?? null,
      photos,
    });
  });

  r.post('/auditoriums', requirePermission('auditorium:create'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const input = auditoriumSchema.parse(req.body);
    const [city] = await db
      .select({ slug: cities.slug })
      .from(cities)
      .where(and(eq(cities.id, input.cityId), eq(cities.isActive, true)));
    if (!city) throw errors.badRequest('UNKNOWN_CITY', 'Choose a city from the list');
    if ((input.latitude === undefined) !== (input.longitude === undefined)) {
      throw errors.badRequest(
        'INCOMPLETE_LOCATION',
        'Provide both latitude and longitude, or neither',
      );
    }

    const base = slugify(`${input.name} ${city.slug}`) || `venue-${city.slug}`;
    let created: typeof auditoriums.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      try {
        [created] = await db
          .insert(auditoriums)
          .values({ ...input, ownerId: scope.ownerId, slug, status: 'DRAFT' })
          .returning();
      } catch (err) {
        if (pgErrorCode(err) !== PG_ERROR.UNIQUE_VIOLATION) throw err;
      }
    }
    if (!created) throw errors.conflict('SLUG_TAKEN', 'Choose a different venue name');

    await audit.record(
      {
        action: 'listing.created',
        entityType: 'auditorium',
        entityId: created.id,
        actorId: me.userId,
        actorRole: me.role,
        after: { name: created.name, slug: created.slug },
      },
      auditContext(req),
    );
    res.status(201).json(created);
  });

  r.patch('/auditoriums/:id', requirePermission('auditorium:update'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const venue = await scoped.auditorium(scope, req.params['id']);
    if (!(EDITABLE_STATUSES as readonly string[]).includes(venue.status)) {
      throw errors.conflict('LISTING_LOCKED', 'This listing is suspended and cannot be edited');
    }
    const input = auditoriumUpdateSchema.parse(req.body);
    if (input.cityId) {
      const [city] = await db
        .select({ id: cities.id })
        .from(cities)
        .where(eq(cities.id, input.cityId));
      if (!city) throw errors.badRequest('UNKNOWN_CITY', 'Choose a city from the list');
    }
    const [updated] = await db
      .update(auditoriums)
      .set(input)
      .where(eq(auditoriums.id, venue.id))
      .returning();
    const changed = Object.keys(input) as (keyof typeof input)[];
    await audit.record(
      {
        action: 'listing.updated',
        entityType: 'auditorium',
        entityId: venue.id,
        actorId: me.userId,
        actorRole: me.role,
        before: Object.fromEntries(changed.map((k) => [k, venue[k]])),
        after: Object.fromEntries(changed.map((k) => [k, updated?.[k]])),
      },
      auditContext(req),
    );
    res.json(updated);
  });

  /** Drafts with no bookings can be deleted outright; anything else is kept for history. */
  r.delete('/auditoriums/:id', requirePermission('auditorium:update'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const venue = await scoped.auditorium(scope, req.params['id']);
    if (venue.status !== 'DRAFT') {
      throw errors.conflict('NOT_A_DRAFT', 'Only draft listings can be deleted');
    }
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(bookings)
      .where(eq(bookings.auditoriumId, venue.id));
    if (n > 0)
      throw errors.conflict('HAS_BOOKINGS', 'This venue has bookings and cannot be deleted');
    const keys = await db
      .select({ key: media.storageKey })
      .from(media)
      .where(eq(media.auditoriumId, venue.id));
    await db.delete(auditoriums).where(eq(auditoriums.id, venue.id));
    await Promise.allSettled(keys.map((k) => storage.delete(k.key)));
    await audit.record(
      {
        action: 'listing.deleted',
        entityType: 'auditorium',
        entityId: venue.id,
        actorId: me.userId,
        actorRole: me.role,
        before: { name: venue.name },
      },
      auditContext(req),
    );
    res.status(204).end();
  });

  /** Checks the listing is complete, then sends it to the admin approval queue. */
  r.post('/auditoriums/:id/submit', requirePermission('auditorium:update'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const venue = await scoped.auditorium(scope, req.params['id']);
    if (venue.status !== 'DRAFT' && venue.status !== 'REJECTED') {
      throw errors.conflict(
        'NOT_SUBMITTABLE',
        `A listing that is ${venue.status.toLowerCase().replace('_', ' ')} cannot be submitted`,
      );
    }

    const missing = await listingGaps(db, venue.id, venue.ownerId);
    if (missing.length > 0) {
      throw new HttpError(422, 'LISTING_INCOMPLETE', 'Finish these before submitting', missing);
    }
    const [updated] = await db
      .update(auditoriums)
      .set({ status: 'PENDING_REVIEW', rejectionReason: null })
      .where(and(eq(auditoriums.id, venue.id), inArray(auditoriums.status, ['DRAFT', 'REJECTED'])))
      .returning(summary);
    await audit.record(
      {
        action: 'listing.submitted',
        entityType: 'auditorium',
        entityId: venue.id,
        actorId: me.userId,
        actorRole: me.role,
        before: { status: venue.status },
        after: { status: 'PENDING_REVIEW' },
      },
      auditContext(req),
    );
    res.json(updated);
  });

  r.put('/auditoriums/:id/amenities', requirePermission('auditorium:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const venue = await scoped.auditorium(scope, req.params['id']);
    const { codes } = amenitiesSchema.parse(req.body);
    const unique = [...new Set(codes)];
    const rows = unique.length
      ? await db
          .select({ id: amenities.id, code: amenities.code })
          .from(amenities)
          .where(and(inArray(amenities.code, unique), eq(amenities.isActive, true)))
      : [];
    if (rows.length !== unique.length) {
      const known = new Set(rows.map((r) => r.code));
      throw errors.badRequest(
        'UNKNOWN_AMENITY',
        `Unknown amenities: ${unique.filter((c) => !known.has(c)).join(', ')}`,
      );
    }
    await db.transaction(async (tx) => {
      await tx.delete(auditoriumAmenities).where(eq(auditoriumAmenities.auditoriumId, venue.id));
      if (rows.length) {
        await tx
          .insert(auditoriumAmenities)
          .values(rows.map((a) => ({ auditoriumId: venue.id, amenityId: a.id })));
      }
    });
    res.json({ codes: unique.sort() });
  });

  r.put(
    '/auditoriums/:id/cancellation-policy',
    requirePermission('auditorium:update'),
    async (req, res) => {
      const scope = await scoped.scope(req);
      requireOwner(scope);
      const venue = await scoped.auditorium(scope, req.params['id']);
      const input = cancellationPolicySchema.parse(req.body);
      const [row] = await db
        .insert(cancellationPolicies)
        .values({ auditoriumId: venue.id, tiers: input.tiers, notes: input.notes })
        .onConflictDoUpdate({
          target: cancellationPolicies.auditoriumId,
          set: { tiers: input.tiers, notes: input.notes },
        })
        .returning();
      res.json(row);
    },
  );

  // ------------------------------------------------------------ halls

  r.post('/auditoriums/:id/halls', requirePermission('auditorium:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const venue = await scoped.auditorium(scope, req.params['id']);
    const input = hallSchema.parse(req.body);
    try {
      const [hall] = await db
        .insert(halls)
        .values({ ...input, auditoriumId: venue.id })
        .returning();
      res.status(201).json(hall);
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
        throw errors.conflict('HALL_NAME_TAKEN', 'This venue already has a hall with that name');
      }
      throw err;
    }
  });

  r.patch('/halls/:hallId', requirePermission('auditorium:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const hall = await scoped.hall(scope, req.params['hallId']);
    const input = hallUpdateSchema.parse(req.body);
    try {
      const [updated] = await db.update(halls).set(input).where(eq(halls.id, hall.id)).returning();
      res.json(updated);
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
        throw errors.conflict('HALL_NAME_TAKEN', 'This venue already has a hall with that name');
      }
      throw err;
    }
  });

  /** Halls with bookings are deactivated instead of deleted, so booking history stays intact. */
  r.delete('/halls/:hallId', requirePermission('auditorium:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const hall = await scoped.hall(scope, req.params['hallId']);
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(bookings)
      .where(eq(bookings.hallId, hall.id));
    if (n > 0) {
      await db.update(halls).set({ isActive: false }).where(eq(halls.id, hall.id));
      res.json({ deactivated: true });
      return;
    }
    await db.delete(halls).where(eq(halls.id, hall.id));
    res.status(204).end();
  });

  // ------------------------------------------------------------ add-ons

  r.post('/auditoriums/:id/addons', requirePermission('auditorium:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const venue = await scoped.auditorium(scope, req.params['id']);
    const input = addonSchema.parse(req.body);
    try {
      const [row] = await db
        .insert(addons)
        .values({ ...input, auditoriumId: venue.id })
        .returning();
      res.status(201).json(row);
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
        throw errors.conflict('ADDON_CODE_TAKEN', 'An add-on with this code already exists');
      }
      throw err;
    }
  });

  r.patch('/addons/:addonId', requirePermission('pricing:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const addon = await scoped.addon(scope, req.params['addonId']);
    const input = addonUpdateSchema.parse(req.body);
    const [row] = await db.update(addons).set(input).where(eq(addons.id, addon.id)).returning();
    res.json(row);
  });

  r.delete('/addons/:addonId', requirePermission('auditorium:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const addon = await scoped.addon(scope, req.params['addonId']);
    try {
      await db.delete(addons).where(eq(addons.id, addon.id));
    } catch (err) {
      // Already used in a booking: keep the row, hide it from new bookings.
      if (pgErrorCode(err) !== PG_ERROR.FOREIGN_KEY_VIOLATION) throw err;
      await db.update(addons).set({ isActive: false }).where(eq(addons.id, addon.id));
    }
    res.status(204).end();
  });

  return r;
}

/** What a listing still needs before it can be reviewed. Empty means ready. */
export async function listingGaps(
  db: Db,
  auditoriumId: string,
  ownerId: string,
): Promise<string[]> {
  const missing: string[] = [];
  const [profile] = await db
    .select({ panLast4: ownerProfiles.panLast4, bank: ownerProfiles.bankAccountLast4 })
    .from(ownerProfiles)
    .where(eq(ownerProfiles.userId, ownerId));
  if (!profile?.panLast4 || !profile.bank)
    missing.push('Add your PAN and bank details in your owner profile');

  const activeHalls = await db
    .select({ id: halls.id, name: halls.name })
    .from(halls)
    .where(and(eq(halls.auditoriumId, auditoriumId), eq(halls.isActive, true)));
  if (activeHalls.length === 0) missing.push('Add at least one hall');

  if (activeHalls.length > 0) {
    const baseRules = await db
      .select({
        hallId: pricingRules.hallId,
        slots: sql<string[]>`array_agg(DISTINCT ${pricingRules.slot}::text)`,
      })
      .from(pricingRules)
      .where(
        and(
          inArray(
            pricingRules.hallId,
            activeHalls.map((h) => h.id),
          ),
          eq(pricingRules.kind, 'BASE'),
        ),
      )
      .groupBy(pricingRules.hallId);
    const bySlots = new Map(baseRules.map((r) => [r.hallId, new Set(r.slots)]));
    for (const h of activeHalls) {
      const have = bySlots.get(h.id) ?? new Set();
      const lacking = ['MORNING', 'EVENING', 'FULL_DAY'].filter((s) => !have.has(s));
      if (lacking.length)
        missing.push(
          `Set a standard price for ${h.name}: ${lacking.map((s) => s.toLowerCase().replace('_', ' ')).join(', ')}`,
        );
    }
  }

  const [policy] = await db
    .select({ id: cancellationPolicies.auditoriumId })
    .from(cancellationPolicies)
    .where(eq(cancellationPolicies.auditoriumId, auditoriumId));
  if (!policy) missing.push('Set a cancellation policy');

  const [{ photos } = { photos: 0 }] = await db
    .select({ photos: count() })
    .from(media)
    .where(and(eq(media.auditoriumId, auditoriumId), eq(media.status, 'READY')));
  if (photos < 3) missing.push(`Upload at least 3 photos (${photos} so far)`);
  return missing;
}
