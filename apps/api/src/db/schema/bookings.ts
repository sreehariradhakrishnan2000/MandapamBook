import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookingSlot, bookingStatus } from './enums.js';
import { users } from './identity.js';
import { type CancellationTier, addons, auditoriums, availabilityBlocks, halls } from './venues.js';
import { createdAt, id, int4range, timestamps } from './types.js';

export interface PriceSnapshot {
  baseRuleId: string;
  basePaise: number;
  addons: {
    addonId: string;
    code: string;
    quantity: number;
    unitPaise: number;
    totalPaise: number;
  }[];
  gstBasisPoints: number;
  platformFeePaise: number;
  cancellationTiers: CancellationTier[];
  /** Which kind of rule set the base price (BASE, WEEKEND, MUHURTHAM, ...). */
  ruleKind?: string;
  advancePercent?: number;
  /** Advance on venue charges + GST, excluding the platform fee. */
  venueAdvancePaise?: number;
}

export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    /** Human-friendly reference shown to customers, e.g. MB-7K3Q9X. */
    refCode: text('ref_code').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    auditoriumId: uuid('auditorium_id')
      .notNull()
      .references(() => auditoriums.id, { onDelete: 'restrict' }),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'restrict' }),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    slot: bookingSlot('slot').notNull(),
    guestCount: integer('guest_count').notNull(),
    status: bookingStatus('status').notNull().default('HELD'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    ownerResponseDueAt: timestamp('owner_response_due_at', { withTimezone: true }),
    subtotalPaise: bigint('subtotal_paise', { mode: 'number' }).notNull(),
    addonsPaise: bigint('addons_paise', { mode: 'number' }).notNull().default(0),
    gstPaise: bigint('gst_paise', { mode: 'number' }).notNull(),
    platformFeePaise: bigint('platform_fee_paise', { mode: 'number' }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    /** Amount collected online. */
    advancePaise: bigint('advance_paise', { mode: 'number' }).notNull(),
    /** Set when the owner records the balance paid at the venue. */
    balanceReceivedAt: timestamp('balance_received_at', { withTimezone: true }),
    priceSnapshot: jsonb('price_snapshot').$type<PriceSnapshot>().notNull(),
    cancellationReason: text('cancellation_reason'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /** Refund owed when a paid booking was cancelled, fixed at cancellation time (Phase 6 pays it). */
    refundDuePaise: bigint('refund_due_paise', { mode: 'number' }),
    /** Optimistic lock for state transitions. */
    version: integer('version').notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('bookings_ref_code_key').on(t.refCode),
    index('bookings_customer_idx').on(t.customerId, t.createdAt),
    index('bookings_auditorium_date_idx').on(t.auditoriumId, t.eventDate),
    index('bookings_hold_expiry_idx')
      .on(t.holdExpiresAt)
      .where(sql`${t.status} IN ('HELD', 'PENDING_PAYMENT')`),
    // One unpaid hold per customer at a time, so nobody can lock up many dates for free.
    uniqueIndex('bookings_one_active_hold_per_customer')
      .on(t.customerId)
      .where(sql`${t.status} IN ('HELD', 'PENDING_PAYMENT')`),
    index('bookings_status_event_date_idx').on(t.status, t.eventDate),
    check('bookings_guest_count', sql`${t.guestCount} > 0`),
    check(
      'bookings_amounts_non_negative',
      sql`${t.subtotalPaise} >= 0 AND ${t.addonsPaise} >= 0 AND ${t.gstPaise} >= 0 AND ${t.platformFeePaise} >= 0 AND ${t.advancePaise} >= 0`,
    ),
    check(
      'bookings_total_matches',
      sql`${t.totalPaise} = ${t.subtotalPaise} + ${t.addonsPaise} + ${t.gstPaise} + ${t.platformFeePaise}`,
    ),
    check('bookings_advance_le_total', sql`${t.advancePaise} <= ${t.totalPaise}`),
    check(
      'bookings_hold_has_expiry',
      sql`${t.status} NOT IN ('HELD', 'PENDING_PAYMENT') OR ${t.holdExpiresAt} IS NOT NULL`,
    ),
  ],
);

export const bookingAddons = pgTable(
  'booking_addons',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    addonId: uuid('addon_id')
      .notNull()
      .references(() => addons.id, { onDelete: 'restrict' }),
    quantity: smallint('quantity').notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('booking_addons_booking_addon_key').on(t.bookingId, t.addonId),
    check('booking_addons_quantity', sql`${t.quantity} > 0`),
    check('booking_addons_total', sql`${t.totalPaise} = ${t.quantity} * ${t.unitPricePaise}`),
  ],
);

export const bookingStatusHistory = pgTable(
  'booking_status_history',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    fromStatus: bookingStatus('from_status'),
    toStatus: bookingStatus('to_status').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('booking_status_history_booking_idx').on(t.bookingId, t.createdAt)],
);

/**
 * One row per thing that occupies a hall slot: a booking or an owner block.
 * Rows are written only by triggers on bookings and availability_blocks.
 * The exclusion constraint `hall_occupancy_no_overlap` (custom migration) makes
 * overlapping active rows impossible, so double booking is rejected by Postgres
 * itself with SQLSTATE 23P01, whatever the application does.
 */
export const hallOccupancy = pgTable(
  'hall_occupancy',
  {
    id: id(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => halls.id, { onDelete: 'cascade' }),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    slot: bookingSlot('slot').notNull(),
    /** MORNING [0,1), EVENING [1,2), FULL_DAY [0,2): FULL_DAY overlaps both. */
    slotSpan: int4range('slot_span')
      .notNull()
      .generatedAlwaysAs(
        sql`CASE slot WHEN 'MORNING' THEN int4range(0, 1) WHEN 'EVENING' THEN int4range(1, 2) ELSE int4range(0, 2) END`,
      ),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    blockId: uuid('block_id').references(() => availabilityBlocks.id, { onDelete: 'cascade' }),
    active: boolean('active').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('hall_occupancy_booking_key').on(t.bookingId),
    uniqueIndex('hall_occupancy_block_key').on(t.blockId),
    index('hall_occupancy_calendar_idx')
      .on(t.hallId, t.eventDate)
      .where(sql`${t.active}`),
    check(
      'hall_occupancy_one_source',
      sql`(${t.bookingId} IS NOT NULL) <> (${t.blockId} IS NOT NULL)`,
    ),
  ],
);
