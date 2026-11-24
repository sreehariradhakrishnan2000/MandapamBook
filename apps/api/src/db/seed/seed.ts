import { applyBasisPoints, rupeesToPaise, sumPaise } from '@mandapambook/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  addons,
  amenities,
  auditoriumAmenities,
  auditoriums,
  cancellationPolicies,
  cities,
  halls,
  muhurthamDates,
  ownerProfiles,
  platformSettings,
  pricingRules,
  users,
} from '../schema/index.js';
import { AMENITIES, CITIES, PLATFORM_SETTINGS } from './master-data.js';
import {
  SAMPLE_AUDITORIUMS,
  SAMPLE_OWNERS,
  type SampleAuditorium,
  type SampleOwner,
} from './sample-data.js';

const SLOTS = ['MORNING', 'EVENING', 'FULL_DAY'] as const;

/** Sample muhurtham dates for demos only; production dates are entered by admins. */
const SAMPLE_MUHURTHAM_DATES = [
  '2027-01-21',
  '2027-02-04',
  '2027-04-26',
  '2027-05-10',
  '2027-08-23',
  '2027-09-06',
];

export interface SeedSummary {
  cities: number;
  amenities: number;
  auditoriumsCreated: number;
  auditoriumsSkipped: number;
}

/** Upserts cities, amenities and default platform settings. Idempotent. */
export async function seedMasterData(db: Db): Promise<Pick<SeedSummary, 'cities' | 'amenities'>> {
  await db.transaction(async (tx) => {
    await tx
      .insert(cities)
      .values(CITIES)
      .onConflictDoUpdate({
        target: cities.slug,
        set: {
          name: sql`excluded.name`,
          district: sql`excluded.district`,
          state: sql`excluded.state`,
          nameI18n: sql`excluded.name_i18n`,
        },
      });
    await tx
      .insert(amenities)
      .values(AMENITIES.map((a, i) => ({ ...a, sortOrder: i })))
      .onConflictDoUpdate({
        target: amenities.code,
        set: {
          name: sql`excluded.name`,
          icon: sql`excluded.icon`,
          nameI18n: sql`excluded.name_i18n`,
          sortOrder: sql`excluded.sort_order`,
        },
      });
    // Settings are only inserted, never overwritten: admins may have changed them.
    await tx
      .insert(platformSettings)
      .values(Object.entries(PLATFORM_SETTINGS).map(([key, value]) => ({ key, value })))
      .onConflictDoNothing();
  });
  return { cities: CITIES.length, amenities: AMENITIES.length };
}

/**
 * Creates fictional owners and approved sample venues with halls, pricing, add-ons
 * and cancellation policies. A venue whose slug already exists is left untouched.
 */
export async function seedSampleData(
  db: Db,
  set: { owners: SampleOwner[]; auditoriums: SampleAuditorium[] } = {
    owners: SAMPLE_OWNERS,
    auditoriums: SAMPLE_AUDITORIUMS,
  },
): Promise<Pick<SeedSummary, 'auditoriumsCreated' | 'auditoriumsSkipped'>> {
  let created = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    for (const owner of set.owners) {
      const [user] = await tx
        .insert(users)
        .values({
          email: owner.email,
          fullName: owner.fullName,
          phone: owner.phone,
          role: 'OWNER',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        })
        .onConflictDoUpdate({ target: users.email, set: { fullName: sql`excluded.full_name` } })
        .returning({ id: users.id });
      if (!user) throw new Error(`could not upsert sample owner ${owner.email}`);
      await tx
        .insert(ownerProfiles)
        .values({ userId: user.id, businessName: owner.businessName, kycStatus: 'VERIFIED' })
        .onConflictDoNothing();
    }

    const ownerRows = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        inArray(
          users.email,
          set.owners.map((o) => o.email),
        ),
      );
    const ownerByEmail = new Map(ownerRows.map((o) => [o.email, o.id]));
    const cityBySlug = new Map(
      (await tx.select({ id: cities.id, slug: cities.slug }).from(cities)).map((c) => [
        c.slug,
        c.id,
      ]),
    );
    const amenityByCode = new Map(
      (await tx.select({ id: amenities.id, code: amenities.code }).from(amenities)).map((a) => [
        a.code,
        a.id,
      ]),
    );

    for (const venue of set.auditoriums) {
      const existing = await tx
        .select({ id: auditoriums.id })
        .from(auditoriums)
        .where(eq(auditoriums.slug, venue.slug));
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      const ownerId = ownerByEmail.get(venue.ownerEmail);
      const cityId = cityBySlug.get(venue.citySlug);
      if (!ownerId || !cityId) throw new Error(`missing owner or city for ${venue.slug}`);

      const {
        amenities: amenityCodes,
        halls: hallSeeds,
        addons: addonSeeds,
        cancellationTiers,
        ownerEmail: _o,
        citySlug: _c,
        ...fields
      } = venue;
      const [aud] = await tx
        .insert(auditoriums)
        .values({ ...fields, ownerId, cityId, status: 'APPROVED', reviewedAt: new Date() })
        .returning({ id: auditoriums.id });
      if (!aud) throw new Error(`could not insert ${venue.slug}`);

      await tx.insert(auditoriumAmenities).values(
        amenityCodes.map((code) => {
          const amenityId = amenityByCode.get(code);
          if (!amenityId) throw new Error(`unknown amenity ${code}`);
          return { auditoriumId: aud.id, amenityId };
        }),
      );

      for (const h of hallSeeds) {
        const [hall] = await tx
          .insert(halls)
          .values({
            auditoriumId: aud.id,
            name: h.name,
            seatingCapacity: h.seatingCapacity,
            diningCapacity: h.diningCapacity,
            isAc: h.isAc,
            diningIsAc: h.diningIsAc ?? h.isAc,
          })
          .returning({ id: halls.id });
        if (!hall) throw new Error(`could not insert hall ${h.name}`);

        await tx.insert(pricingRules).values(
          SLOTS.flatMap((slot) => {
            const base = rupeesToPaise(h.baseRupees[slot]);
            const uplift = (percent: number) =>
              sumPaise(base, applyBasisPoints(base, percent * 100));
            return [
              {
                hallId: hall.id,
                slot,
                kind: 'BASE' as const,
                pricePaise: base,
                priority: 0,
                label: 'Standard',
              },
              {
                hallId: hall.id,
                slot,
                kind: 'WEEKEND' as const,
                pricePaise: uplift(h.weekendUpliftPercent),
                priority: 10,
                label: 'Weekend',
              },
              {
                hallId: hall.id,
                slot,
                kind: 'MUHURTHAM' as const,
                pricePaise: uplift(h.muhurthamUpliftPercent),
                priority: 20,
                label: 'Muhurtham day',
              },
            ];
          }),
        );
      }

      await tx.insert(addons).values(
        addonSeeds.map((a) => ({
          auditoriumId: aud.id,
          code: a.code,
          name: a.name,
          unit: a.unit,
          pricePaise: rupeesToPaise(a.rupees),
          maxQuantity: a.maxQuantity,
        })),
      );
      await tx
        .insert(cancellationPolicies)
        .values({ auditoriumId: aud.id, tiers: cancellationTiers });
      created++;
    }

    await tx
      .insert(muhurthamDates)
      .values(SAMPLE_MUHURTHAM_DATES.map((date) => ({ date, label: 'Sample muhurtham' })))
      .onConflictDoNothing();
  });

  return { auditoriumsCreated: created, auditoriumsSkipped: skipped };
}
