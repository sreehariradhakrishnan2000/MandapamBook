import { Router } from 'express';
import { and, asc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import {
  boundingBox,
  type Coordinates,
  DEFAULT_SEARCH_RADIUS_KM,
  distanceKm,
  type SearchResult,
  searchQuerySchema,
} from '@mandapambook/shared';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  addons,
  amenities,
  auditoriumAmenities,
  auditoriums,
  bookings,
  cancellationPolicies,
  cities,
  hallOccupancy,
  halls,
  media,
  muhurthamDates,
  ownerProfiles,
  pricingRules,
} from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { todayInIst } from '../../lib/time.js';
import { escapeLike } from '../admin/listings-review.routes.js';
import { type PriceRule, type Slot, resolvePriceRule } from '../bookings/pricing.js';

const SLOTS: Slot[] = ['MORNING', 'EVENING', 'FULL_DAY'];
const OVERLAPS: Record<Slot, Slot[]> = {
  MORNING: ['MORNING', 'FULL_DAY'],
  EVENING: ['EVENING', 'FULL_DAY'],
  FULL_DAY: ['MORNING', 'EVENING', 'FULL_DAY'],
};
/** Search filters run over at most this many venues per query before paging. */
const CANDIDATE_LIMIT = 500;
const PHOTO_TTL = 600;

/** Occupied slots per hall per date, treating holds past their expiry as free. */
async function occupancy(db: Db, hallIds: string[], from: string, to: string) {
  if (!hallIds.length) return new Map<string, Map<string, Set<Slot>>>();
  const rows = await db
    .select({
      hallId: hallOccupancy.hallId,
      eventDate: hallOccupancy.eventDate,
      slot: hallOccupancy.slot,
      status: bookings.status,
      holdExpiresAt: bookings.holdExpiresAt,
    })
    .from(hallOccupancy)
    .leftJoin(bookings, eq(bookings.id, hallOccupancy.bookingId))
    .where(
      and(
        inArray(hallOccupancy.hallId, hallIds),
        eq(hallOccupancy.active, true),
        gte(hallOccupancy.eventDate, from),
        lte(hallOccupancy.eventDate, to),
      ),
    );
  const now = Date.now();
  const map = new Map<string, Map<string, Set<Slot>>>();
  for (const r of rows) {
    const staleHold =
      (r.status === 'HELD' || r.status === 'PENDING_PAYMENT') &&
      r.holdExpiresAt !== null &&
      r.holdExpiresAt.getTime() <= now;
    if (staleHold) continue;
    const byDate = map.get(r.hallId) ?? new Map<string, Set<Slot>>();
    const set = byDate.get(r.eventDate) ?? new Set<Slot>();
    set.add(r.slot);
    byDate.set(r.eventDate, set);
    map.set(r.hallId, byDate);
  }
  return map;
}

function isFree(taken: Set<Slot> | undefined, slot: Slot): boolean {
  return !taken || !OVERLAPS[slot].some((s) => taken.has(s));
}

export function venuesRouter(deps: { db: Db; storage: ObjectStorage }): Router {
  const { db, storage } = deps;
  const r = Router();

  /**
   * Search approved venues. Database filters narrow the candidates; price and availability
   * for the requested date are then computed with the same rules the booking flow uses.
   */
  r.get('/auditoriums', async (req, res) => {
    const q = searchQuerySchema.parse(req.query);
    if (q.date && q.date < todayInIst())
      throw errors.badRequest('DATE_IN_PAST', 'Choose today or a future date');

    // "Near me": a bounding box narrows candidates in SQL; the exact distance is checked below.
    const centre: Coordinates | null =
      q.lat !== undefined && q.lng !== undefined ? { latitude: q.lat, longitude: q.lng } : null;
    const radiusKm = q.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM;
    const box = centre ? boundingBox(centre, radiusKm) : null;

    const conditions = [
      box ? isNotNull(auditoriums.latitude) : undefined,
      box ? gte(auditoriums.latitude, box.minLat) : undefined,
      box ? lte(auditoriums.latitude, box.maxLat) : undefined,
      box ? gte(auditoriums.longitude, box.minLon) : undefined,
      box ? lte(auditoriums.longitude, box.maxLon) : undefined,
      eq(auditoriums.status, 'APPROVED'),
      q.city ? eq(cities.slug, q.city) : undefined,
      q.minParking !== undefined ? gte(auditoriums.parkingCars, q.minParking) : undefined,
      q.minRooms !== undefined ? gte(auditoriums.guestRooms, q.minRooms) : undefined,
      q.catering ? eq(auditoriums.cateringPolicy, q.catering) : undefined,
      q.decoration ? eq(auditoriums.decorationPolicy, q.decoration) : undefined,
      q.minRating !== undefined ? gte(auditoriums.ratingAvg, String(q.minRating)) : undefined,
      q.q
        ? or(
            ilike(auditoriums.name, `%${escapeLike(q.q)}%`),
            ilike(auditoriums.locality, `%${escapeLike(q.q)}%`),
          )
        : undefined,
    ];
    if (q.amenities?.length) {
      // Venues that have every requested amenity.
      conditions.push(
        inArray(
          auditoriums.id,
          db
            .select({ id: auditoriumAmenities.auditoriumId })
            .from(auditoriumAmenities)
            .innerJoin(amenities, eq(amenities.id, auditoriumAmenities.amenityId))
            .where(inArray(amenities.code, q.amenities))
            .groupBy(auditoriumAmenities.auditoriumId)
            .having(sql`count(DISTINCT ${amenities.code}) = ${q.amenities.length}`),
        ),
      );
    }

    const candidates = await db
      .select({
        id: auditoriums.id,
        slug: auditoriums.slug,
        name: auditoriums.name,
        city: cities.name,
        state: cities.state,
        locality: auditoriums.locality,
        latitude: auditoriums.latitude,
        longitude: auditoriums.longitude,
        parkingCars: auditoriums.parkingCars,
        guestRooms: auditoriums.guestRooms,
        cateringPolicy: auditoriums.cateringPolicy,
        ratingAvg: auditoriums.ratingAvg,
        ratingCount: auditoriums.ratingCount,
        updatedAt: auditoriums.updatedAt,
      })
      .from(auditoriums)
      .innerJoin(cities, eq(cities.id, auditoriums.cityId))
      .where(and(...conditions))
      .limit(CANDIDATE_LIMIT);
    type Candidate = (typeof candidates)[number] & { distanceKm: number | null };
    const venues = candidates.flatMap((v): Candidate[] => {
      if (!centre) return [{ ...v, distanceKm: null }];
      if (v.latitude === null || v.longitude === null) return [];
      const d = distanceKm(centre, { latitude: v.latitude, longitude: v.longitude });
      return d <= radiusKm ? [{ ...v, distanceKm: Math.round(d * 10) / 10 }] : [];
    });
    const venueIds = venues.map((v) => v.id);

    const hallRows = venueIds.length
      ? await db
          .select()
          .from(halls)
          .where(
            and(
              inArray(halls.auditoriumId, venueIds),
              eq(halls.isActive, true),
              q.guests ? gte(halls.seatingCapacity, q.guests) : undefined,
              q.ac ? eq(halls.isAc, true) : undefined,
            ),
          )
      : [];
    const hallIds = hallRows.map((h) => h.id);
    const [rules, muhurtham, taken, photos] = await Promise.all([
      hallIds.length
        ? db.select().from(pricingRules).where(inArray(pricingRules.hallId, hallIds))
        : Promise.resolve([]),
      q.date
        ? db.select().from(muhurthamDates).where(eq(muhurthamDates.date, q.date))
        : Promise.resolve([]),
      q.date
        ? occupancy(db, hallIds, q.date, q.date)
        : Promise.resolve(new Map<string, Map<string, Set<Slot>>>()),
      venueIds.length
        ? db
            .selectDistinctOn([media.auditoriumId], {
              auditoriumId: media.auditoriumId,
              storageKey: media.storageKey,
            })
            .from(media)
            .where(and(inArray(media.auditoriumId, venueIds), eq(media.status, 'READY')))
            .orderBy(media.auditoriumId, asc(media.sortOrder), asc(media.createdAt))
        : Promise.resolve([]),
    ]);
    const rulesByHall = new Map<string, PriceRule[]>();
    for (const rule of rules)
      rulesByHall.set(rule.hallId, [...(rulesByHall.get(rule.hallId) ?? []), rule]);
    const photoByVenue = new Map(photos.map((p) => [p.auditoriumId, p.storageKey]));

    const results: (SearchResult & { _updated: number })[] = [];
    for (const v of venues) {
      const vHalls = hallRows.filter((h) => h.auditoriumId === v.id);
      if (!vHalls.length) continue;
      const muhurthamSet = new Set(
        muhurtham.filter((m) => m.state === null || m.state === v.state).map((m) => m.date),
      );
      let best: number | null = null;
      let anyFree = false;
      for (const h of vHalls) {
        const hallRules = rulesByHall.get(h.id) ?? [];
        const slots = q.slot ? [q.slot] : SLOTS;
        for (const slot of slots) {
          const price = q.date
            ? resolvePriceRule(hallRules, q.date, slot, muhurthamSet)?.pricePaise
            : hallRules
                .filter((x) => x.kind === 'BASE' && x.slot === slot)
                .map((x) => x.pricePaise)[0];
          if (price === undefined) continue;
          const free = !q.date || isFree(taken.get(h.id)?.get(q.date), slot);
          if (q.date && !free) continue;
          if (q.maxPricePaise !== undefined && price > q.maxPricePaise) continue;
          anyFree = true;
          if (best === null || price < best) best = price;
        }
      }
      if (!anyFree) continue;
      const key = photoByVenue.get(v.id);
      results.push({
        id: v.id,
        slug: v.slug,
        name: v.name,
        city: v.city,
        locality: v.locality,
        maxCapacity: Math.max(...vHalls.map((h) => h.seatingCapacity)),
        hasAc: vHalls.some((h) => h.isAc),
        parkingCars: v.parkingCars,
        guestRooms: v.guestRooms,
        cateringPolicy: v.cateringPolicy,
        ratingAvg: v.ratingAvg === null ? null : Number(v.ratingAvg),
        ratingCount: v.ratingCount,
        fromPricePaise: best,
        photoUrl: key ? await storage.createDownloadUrl(key, PHOTO_TTL) : null,
        available: q.date ? true : null,
        distanceKm: v.distanceKm,
        _updated: v.updatedAt.getTime(),
      });
    }

    const sorters: Record<
      typeof q.sort,
      (a: (typeof results)[number], b: (typeof results)[number]) => number
    > = {
      recommended: (a, b) =>
        (b.ratingAvg ?? 0) * Math.log1p(b.ratingCount) -
          (a.ratingAvg ?? 0) * Math.log1p(a.ratingCount) || b._updated - a._updated,
      price_asc: (a, b) => (a.fromPricePaise ?? Infinity) - (b.fromPricePaise ?? Infinity),
      price_desc: (a, b) => (b.fromPricePaise ?? 0) - (a.fromPricePaise ?? 0),
      rating: (a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) || b.ratingCount - a.ratingCount,
      capacity: (a, b) => b.maxCapacity - a.maxCapacity,
      distance: (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    };
    results.sort(sorters[q.sort]);
    const start = (q.page - 1) * q.pageSize;
    res.set('Cache-Control', 'public, max-age=30').json({
      items: results.slice(start, start + q.pageSize).map(({ _updated, ...rest }) => rest),
      total: results.length,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  /** Public venue page. Only approved venues exist from the public's point of view. */
  r.get('/auditoriums/:slug', async (req, res) => {
    const slug = z
      .string()
      .regex(/^[a-z0-9-]{1,120}$/)
      .safeParse(req.params['slug']);
    if (!slug.success) throw errors.notFound();
    const [venue] = await db
      .select({
        a: auditoriums,
        city: cities.name,
        state: cities.state,
        citySlug: cities.slug,
        businessName: ownerProfiles.businessName,
      })
      .from(auditoriums)
      .innerJoin(cities, eq(cities.id, auditoriums.cityId))
      .innerJoin(ownerProfiles, eq(ownerProfiles.userId, auditoriums.ownerId))
      .where(and(eq(auditoriums.slug, slug.data), eq(auditoriums.status, 'APPROVED')));
    if (!venue) throw errors.notFound('Venue not found');
    const id = venue.a.id;
    const [hallRows, rules, amenityRows, addonRows, policy, photos] = await Promise.all([
      db
        .select()
        .from(halls)
        .where(and(eq(halls.auditoriumId, id), eq(halls.isActive, true)))
        .orderBy(asc(halls.name)),
      db
        .select({
          hallId: pricingRules.hallId,
          slot: pricingRules.slot,
          pricePaise: pricingRules.pricePaise,
        })
        .from(pricingRules)
        .innerJoin(halls, eq(halls.id, pricingRules.hallId))
        .where(and(eq(halls.auditoriumId, id), eq(pricingRules.kind, 'BASE'))),
      db
        .select({ code: amenities.code, name: amenities.name, icon: amenities.icon })
        .from(auditoriumAmenities)
        .innerJoin(amenities, eq(amenities.id, auditoriumAmenities.amenityId))
        .where(and(eq(auditoriumAmenities.auditoriumId, id), eq(amenities.isActive, true))),
      db
        .select({
          id: addons.id,
          code: addons.code,
          name: addons.name,
          description: addons.description,
          unit: addons.unit,
          pricePaise: addons.pricePaise,
          maxQuantity: addons.maxQuantity,
        })
        .from(addons)
        .where(and(eq(addons.auditoriumId, id), eq(addons.isActive, true))),
      db
        .select({ tiers: cancellationPolicies.tiers, notes: cancellationPolicies.notes })
        .from(cancellationPolicies)
        .where(eq(cancellationPolicies.auditoriumId, id)),
      db
        .select({ storageKey: media.storageKey, altText: media.altText })
        .from(media)
        .where(and(eq(media.auditoriumId, id), eq(media.status, 'READY')))
        .orderBy(asc(media.sortOrder), asc(media.createdAt)),
    ]);
    const a = venue.a;
    res.set('Cache-Control', 'public, max-age=60').json({
      id: a.id,
      slug: a.slug,
      name: a.name,
      description: a.description,
      addressLine: a.addressLine,
      locality: a.locality,
      pincode: a.pincode,
      city: venue.city,
      citySlug: venue.citySlug,
      state: venue.state,
      latitude: a.latitude,
      longitude: a.longitude,
      hostedBy: venue.businessName,
      cateringPolicy: a.cateringPolicy,
      decorationPolicy: a.decorationPolicy,
      parkingCars: a.parkingCars,
      parkingTwoWheelers: a.parkingTwoWheelers,
      guestRooms: a.guestRooms,
      hasGenerator: a.hasGenerator,
      advancePercent: a.advancePercent,
      instantBook: a.instantBook,
      ratingAvg: a.ratingAvg === null ? null : Number(a.ratingAvg),
      ratingCount: a.ratingCount,
      halls: hallRows.map((h) => ({
        id: h.id,
        name: h.name,
        seatingCapacity: h.seatingCapacity,
        diningCapacity: h.diningCapacity,
        isAc: h.isAc,
        basePrices: Object.fromEntries(
          rules.filter((r) => r.hallId === h.id).map((r) => [r.slot, r.pricePaise]),
        ),
      })),
      amenities: amenityRows,
      addons: addonRows,
      cancellationPolicy: policy[0] ?? null,
      photos: await Promise.all(
        photos.map(async (p) => ({
          url: await storage.createDownloadUrl(p.storageKey, PHOTO_TTL),
          altText: p.altText,
        })),
      ),
    });
  });

  /** Taken slots per hall for a month. Reveals only that a slot is taken, never by whom. */
  r.get('/auditoriums/:id/availability', async (req, res) => {
    const id = z.uuid().safeParse(req.params['id']);
    const month = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .safeParse(req.query['month']);
    if (!id.success) throw errors.notFound();
    if (!month.success) throw errors.badRequest('BAD_MONTH', 'Use month=YYYY-MM');
    const [venue] = await db
      .select({ id: auditoriums.id })
      .from(auditoriums)
      .where(and(eq(auditoriums.id, id.data), eq(auditoriums.status, 'APPROVED')));
    if (!venue) throw errors.notFound('Venue not found');
    const [y, m] = month.data.split('-').map(Number) as [number, number];
    const from = `${month.data}-01`;
    const to = `${month.data}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const hallRows = await db
      .select({ id: halls.id, name: halls.name })
      .from(halls)
      .where(and(eq(halls.auditoriumId, venue.id), eq(halls.isActive, true)));
    const taken = await occupancy(
      db,
      hallRows.map((h) => h.id),
      from,
      to,
    );
    res.set('Cache-Control', 'public, max-age=30').json({
      month: month.data,
      halls: hallRows.map((h) => ({
        hallId: h.id,
        name: h.name,
        taken: Object.fromEntries(
          [...(taken.get(h.id) ?? new Map<string, Set<Slot>>())].map(([d, s]) => [d, [...s]]),
        ),
      })),
    });
  });

  return r;
}
