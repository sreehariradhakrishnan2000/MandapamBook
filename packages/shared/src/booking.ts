import { z } from 'zod';
import { slotSchema } from './listing.js';

const isoDate = z.iso.date();
const csv = z
  .string()
  .max(500)
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

export const SEARCH_SORTS = [
  'recommended',
  'price_asc',
  'price_desc',
  'rating',
  'capacity',
  'distance',
] as const;

/** Radius used for a "near me" search when none is given. */
export const DEFAULT_SEARCH_RADIUS_KM = 25;
export const SEARCH_RADII_KM = [5, 10, 25, 50, 100] as const;

/**
 * Public venue search. Prices are paise; dates are IST calendar dates. `lat`/`lng` limit
 * results to venues within `radiusKm` of that point and add a distance to each result.
 */
export const searchQuerySchema = z
  .strictObject({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().int().min(1).max(500).optional(),
    city: z
      .string()
      .regex(/^[a-z0-9-]{2,80}$/)
      .optional(),
    date: isoDate.optional(),
    slot: slotSchema.optional(),
    guests: z.coerce.number().int().min(1).max(20000).optional(),
    maxPricePaise: z.coerce.number().int().min(0).max(10_000_000_00).optional(),
    ac: boolParam.optional(),
    minParking: z.coerce.number().int().min(0).max(5000).optional(),
    minRooms: z.coerce.number().int().min(0).max(500).optional(),
    catering: z.enum(['IN_HOUSE_ONLY', 'OUTSIDE_ALLOWED', 'NO_CATERING']).optional(),
    decoration: z.enum(['IN_HOUSE_ONLY', 'OUTSIDE_ALLOWED', 'NOT_ALLOWED']).optional(),
    amenities: csv.pipe(z.array(z.string().regex(/^[a-z0-9_]+$/)).max(20)).optional(),
    minRating: z.coerce.number().min(1).max(5).optional(),
    q: z.string().trim().max(80).optional(),
    sort: z.enum(SEARCH_SORTS).default('recommended'),
    page: z.coerce.number().int().min(1).max(100).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
  })
  .superRefine((q, ctx) => {
    if ((q.lat === undefined) !== (q.lng === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Give both lat and lng' });
    }
    if (q.sort === 'distance' && q.lat === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['sort'],
        message: 'Sorting by distance needs a location',
      });
    }
    if (q.radiusKm !== undefined && q.lat === undefined) {
      ctx.addIssue({ code: 'custom', path: ['radiusKm'], message: 'A radius needs a location' });
    }
  });
export type SearchQuery = z.input<typeof searchQuerySchema>;

export interface SearchResult {
  id: string;
  slug: string;
  name: string;
  city: string;
  locality: string | null;
  maxCapacity: number;
  hasAc: boolean;
  parkingCars: number;
  guestRooms: number;
  cateringPolicy: string;
  ratingAvg: number | null;
  ratingCount: number;
  /** Lowest price among matching halls for the date/slot, or the lowest standard price. */
  fromPricePaise: number | null;
  photoUrl: string | null;
  /** True when a date was given and at least one matching hall is free. */
  available: boolean | null;
  /** Kilometres from the searched location, to one decimal; null without `lat`/`lng`. */
  distanceKm: number | null;
}

export const quoteRequestSchema = z.strictObject({
  hallId: z.uuid(),
  eventDate: isoDate,
  slot: slotSchema,
  guestCount: z.number().int().min(1).max(20000),
  addons: z
    .array(z.strictObject({ addonId: z.uuid(), quantity: z.number().int().min(1).max(500) }))
    .max(20)
    .default([])
    .refine(
      (a) => new Set(a.map((x) => x.addonId)).size === a.length,
      'Each add-on can appear once',
    ),
});
export type QuoteRequest = z.input<typeof quoteRequestSchema>;

export const cancelBookingSchema = z.strictObject({
  reason: z.string().trim().max(500).optional(),
});

export const ownerBookingQuerySchema = z.strictObject({
  status: z
    .enum([
      'HELD',
      'PENDING_PAYMENT',
      'AWAITING_OWNER',
      'CONFIRMED',
      'COMPLETED',
      'CANCELLED',
      'EXPIRED',
      'REFUNDED',
    ])
    .optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface QuoteView {
  hallId: string;
  eventDate: string;
  slot: 'MORNING' | 'EVENING' | 'FULL_DAY';
  ruleKind: string;
  basePaise: number;
  addons: {
    addonId: string;
    code: string;
    name: string;
    quantity: number;
    unitPaise: number;
    totalPaise: number;
  }[];
  addonsPaise: number;
  venueChargesPaise: number;
  gstPaise: number;
  gstBasisPoints: number;
  platformFeePaise: number;
  totalPaise: number;
  payNowPaise: number;
  payLaterPaise: number;
  advancePercent: number;
  available: boolean;
}

/** Customer-facing booking reference, e.g. MB-7K3Q9X (no ambiguous characters). */
export const BOOKING_REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
