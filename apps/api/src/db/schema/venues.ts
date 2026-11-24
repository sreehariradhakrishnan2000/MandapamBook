import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from 'drizzle-orm/pg-core';
import {
  addonUnit,
  bookingSlot,
  cateringPolicy,
  decorationPolicy,
  listingStatus,
  mediaStatus,
  pricingRuleKind,
} from './enums.js';
import { ownerProfiles, users } from './identity.js';
import { createdAt, id, timestamps } from './types.js';

// ---------- Master data ----------

export const cities = pgTable(
  'cities',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    district: text('district').notNull(),
    state: text('state').notNull(),
    /** Localised names keyed by locale, e.g. {"ml": "കൊച്ചി"} */
    nameI18n: jsonb('name_i18n').$type<Record<string, string>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('cities_slug_key').on(t.slug),
    check('cities_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const amenities = pgTable(
  'amenities',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    nameI18n: jsonb('name_i18n').$type<Record<string, string>>().notNull().default({}),
    icon: text('icon'),
    sortOrder: smallint('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('amenities_code_key').on(t.code),
    check('amenities_code_format', sql`${t.code} ~ '^[a-z0-9_]+$'`),
  ],
);

/** Auspicious dates (admin-managed). Pricing rules of kind MUHURTHAM apply on these. */
export const muhurthamDates = pgTable('muhurtham_dates', {
  date: date('date', { mode: 'string' }).primaryKey(),
  label: text('label'),
  /** Optional per-state calendar; null means nationwide. */
  state: text('state'),
  createdAt: createdAt(),
});

// ---------- Listings ----------

export const auditoriums = pgTable(
  'auditoriums',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => ownerProfiles.userId, { onDelete: 'restrict' }),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    addressLine: text('address_line').notNull(),
    locality: text('locality'),
    pincode: text('pincode').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    status: listingStatus('status').notNull().default('DRAFT'),
    rejectionReason: text('rejection_reason'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    cateringPolicy: cateringPolicy('catering_policy').notNull(),
    decorationPolicy: decorationPolicy('decoration_policy').notNull(),
    parkingCars: integer('parking_cars').notNull().default(0),
    parkingTwoWheelers: integer('parking_two_wheelers').notNull().default(0),
    guestRooms: integer('guest_rooms').notNull().default(0),
    hasGenerator: boolean('has_generator').notNull().default(false),
    /** A space on site where a sadya (Kerala feast) can be prepared. */
    sadyaPrepArea: boolean('sadya_prep_area').notNull().default(false),
    /** Cooking equipment provided for it: vessels, stoves, burners. */
    cookingEquipment: boolean('cooking_equipment').notNull().default(false),
    /** Percentage of the booking total collected online as advance (10–100). */
    advancePercent: smallint('advance_percent').notNull().default(25),
    /** When false, paid bookings wait for the owner in AWAITING_OWNER. */
    instantBook: boolean('instant_book').notNull().default(true),
    /** Denormalised from reviews for search; maintained by the reviews module. */
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('auditoriums_slug_key').on(t.slug),
    index('auditoriums_owner_idx').on(t.ownerId),
    index('auditoriums_city_status_idx').on(t.cityId, t.status),
    index('auditoriums_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
    check('auditoriums_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('auditoriums_advance_percent', sql`${t.advancePercent} BETWEEN 10 AND 100`),
    check(
      'auditoriums_counts_non_negative',
      sql`${t.parkingCars} >= 0 AND ${t.parkingTwoWheelers} >= 0 AND ${t.guestRooms} >= 0`,
    ),
    check(
      'auditoriums_coordinates',
      sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL) OR (${t.latitude} BETWEEN 6 AND 37 AND ${t.longitude} BETWEEN 68 AND 98)`,
    ),
    check('auditoriums_rating', sql`${t.ratingAvg} IS NULL OR ${t.ratingAvg} BETWEEN 1 AND 5`),
  ],
);

export const auditoriumAmenities = pgTable(
  'auditorium_amenities',
  {
    auditoriumId: uuid('auditorium_id')
      .notNull()
      .references(() => auditoriums.id, { onDelete: 'cascade' }),
    amenityId: uuid('amenity_id')
      .notNull()
      .references(() => amenities.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.auditoriumId, t.amenityId] }),
    index('auditorium_amenities_amenity_idx').on(t.amenityId),
  ],
);

export const halls = pgTable(
  'halls',
  {
    id: id(),
    auditoriumId: uuid('auditorium_id')
      .notNull()
      .references(() => auditoriums.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    seatingCapacity: integer('seating_capacity').notNull(),
    diningCapacity: integer('dining_capacity').notNull().default(0),
    isAc: boolean('is_ac').notNull().default(false),
    /** The dining area's air-conditioning, which often differs from the main hall's. */
    diningIsAc: boolean('dining_is_ac').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index('halls_auditorium_idx').on(t.auditoriumId),
    index('halls_capacity_idx').on(t.seatingCapacity),
    uniqueIndex('halls_auditorium_name_key').on(t.auditoriumId, t.name),
    check('halls_capacity', sql`${t.seatingCapacity} > 0 AND ${t.diningCapacity} >= 0`),
  ],
);

export const media = pgTable(
  'media',
  {
    id: id(),
    auditoriumId: uuid('auditorium_id')
      .notNull()
      .references(() => auditoriums.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    altText: text('alt_text').notNull().default(''),
    sortOrder: smallint('sort_order').notNull().default(0),
    status: mediaStatus('status').notNull().default('PENDING_UPLOAD'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('media_storage_key_key').on(t.storageKey),
    index('media_auditorium_idx').on(t.auditoriumId, t.sortOrder),
    check('media_mime', sql`${t.mimeType} IN ('image/jpeg', 'image/png', 'image/webp')`),
    check('media_size', sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`),
  ],
);

export const addons = pgTable(
  'addons',
  {
    id: id(),
    auditoriumId: uuid('auditorium_id')
      .notNull()
      .references(() => auditoriums.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    unit: addonUnit('unit').notNull().default('PER_EVENT'),
    pricePaise: bigint('price_paise', { mode: 'number' }).notNull(),
    maxQuantity: smallint('max_quantity').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('addons_auditorium_code_key').on(t.auditoriumId, t.code),
    check('addons_price', sql`${t.pricePaise} >= 0`),
    check('addons_max_quantity', sql`${t.maxQuantity} BETWEEN 1 AND 500`),
  ],
);

export interface CancellationTier {
  /** Applies when the event is at least this many days away. */
  minDaysBefore: number;
  refundPercent: number;
}

export const cancellationPolicies = pgTable(
  'cancellation_policies',
  {
    auditoriumId: uuid('auditorium_id')
      .primaryKey()
      .references(() => auditoriums.id, { onDelete: 'cascade' }),
    /** Sorted by minDaysBefore descending; validated by Zod on write. */
    tiers: jsonb('tiers').$type<CancellationTier[]>().notNull(),
    notes: text('notes').notNull().default(''),
    ...timestamps(),
  },
  (t) => [check('cancellation_policies_tiers_array', sql`jsonb_typeof(${t.tiers}) = 'array'`)],
);

/**
 * Price for a hall slot. The highest-priority matching rule wins; BASE rules
 * (no date range) are the fallback. Evaluated by the pricing module.
 */
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: id(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    slot: bookingSlot('slot').notNull(),
    kind: pricingRuleKind('kind').notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    pricePaise: bigint('price_paise', { mode: 'number' }).notNull(),
    priority: smallint('priority').notNull().default(0),
    label: text('label'),
    ...timestamps(),
  },
  (t) => [
    index('pricing_rules_hall_slot_idx').on(t.hallId, t.slot),
    check('pricing_rules_price', sql`${t.pricePaise} > 0`),
    check(
      'pricing_rules_range',
      sql`${t.validFrom} IS NULL OR ${t.validTo} IS NULL OR ${t.validFrom} <= ${t.validTo}`,
    ),
    check(
      'pricing_rules_kind_dates',
      sql`(${t.kind} IN ('BASE', 'WEEKEND', 'MUHURTHAM')) OR (${t.validFrom} IS NOT NULL AND ${t.validTo} IS NOT NULL)`,
    ),
  ],
);

/** Owner-blocked dates (maintenance, private use). Occupies the slot like a booking. */
/**
 * A booking the venue took outside MandapamBook (phone, walk-in). It holds its dates through
 * availability_blocks rows, so online bookings can never be taken on top of it. Cancelling
 * deletes those blocks and keeps this record.
 */
export const offlineBookings = pgTable(
  'offline_bookings',
  {
    id: id(),
    auditoriumId: uuid('auditorium_id')
      .notNull()
      .references(() => auditoriums.id, { onDelete: 'cascade' }),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    customerName: text('customer_name').notNull(),
    /** E.164 (+91…). Lets the guest review the venue later from an account with this number. */
    customerPhone: text('customer_phone').notNull(),
    eventType: text('event_type'),
    amountPaise: bigint('amount_paise', { mode: 'number' }),
    advancePaise: bigint('advance_paise', { mode: 'number' }),
    notes: text('notes'),
    status: text('status').notNull().default('ACTIVE'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index('offline_bookings_auditorium_idx').on(t.auditoriumId, t.status),
    index('offline_bookings_phone_idx').on(t.customerPhone),
    check('offline_bookings_status', sql`${t.status} IN ('ACTIVE', 'CANCELLED')`),
    check('offline_bookings_phone', sql`${t.customerPhone} ~ '^\\+91[6-9][0-9]{9}$'`),
    check(
      'offline_bookings_amounts',
      sql`(${t.amountPaise} IS NULL OR ${t.amountPaise} >= 0) AND (${t.advancePaise} IS NULL OR ${t.advancePaise} >= 0)`,
    ),
  ],
);

export const availabilityBlocks = pgTable(
  'availability_blocks',
  {
    id: id(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    slot: bookingSlot('slot').notNull(),
    reason: text('reason'),
    /** Set when this block holds a date for an offline booking. */
    offlineBookingId: uuid('offline_booking_id').references(() => offlineBookings.id, {
      onDelete: 'cascade',
    }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('availability_blocks_hall_date_idx').on(t.hallId, t.eventDate),
    index('availability_blocks_offline_idx').on(t.offlineBookingId),
  ],
);
