import { sql } from 'drizzle-orm';
import {
  bigint,
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
import {
  notificationChannel,
  notificationStatus,
  paymentStatus,
  payoutStatus,
  refundStatus,
  reviewStatus,
} from './enums.js';
import { bookings } from './bookings.js';
import { ownerProfiles, users } from './identity.js';
import { auditoriums, offlineBookings } from './venues.js';
import { citext, createdAt, id, timestamps } from './types.js';

export const payments = pgTable(
  'payments',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    providerOrderId: text('provider_order_id').notNull(),
    providerPaymentId: text('provider_payment_id'),
    status: paymentStatus('status').notNull().default('CREATED'),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    refundedPaise: bigint('refunded_paise', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** Last provider payload, for reconciliation. Never contains card data. */
    rawPayload: jsonb('raw_payload'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('payments_idempotency_key').on(t.idempotencyKey),
    uniqueIndex('payments_provider_order_key').on(t.provider, t.providerOrderId),
    uniqueIndex('payments_provider_payment_key')
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} IS NOT NULL`),
    index('payments_booking_idx').on(t.bookingId),
    check('payments_amount', sql`${t.amountPaise} > 0`),
    check(
      'payments_refunded_le_amount',
      sql`${t.refundedPaise} >= 0 AND ${t.refundedPaise} <= ${t.amountPaise}`,
    ),
    check('payments_currency', sql`${t.currency} = 'INR'`),
  ],
);

/** Every webhook delivery, deduplicated by provider event id (replay protection). */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
  },
  (t) => [uniqueIndex('webhook_events_provider_event_key').on(t.provider, t.eventId)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    status: refundStatus('status').notNull().default('PENDING'),
    providerRefundId: text('provider_refund_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    reason: text('reason').notNull(),
    initiatedBy: uuid('initiated_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('refunds_idempotency_key').on(t.idempotencyKey),
    index('refunds_payment_idx').on(t.paymentId),
    check('refunds_amount', sql`${t.amountPaise} > 0`),
  ],
);

/** Owner earnings per booking. Tracked here; money movement happens outside the platform. */
export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => ownerProfiles.userId, { onDelete: 'restrict' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    grossPaise: bigint('gross_paise', { mode: 'number' }).notNull(),
    commissionPaise: bigint('commission_paise', { mode: 'number' }).notNull(),
    netPaise: bigint('net_paise', { mode: 'number' }).notNull(),
    status: payoutStatus('status').notNull().default('PENDING'),
    reference: text('reference'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('payouts_booking_key').on(t.bookingId),
    index('payouts_owner_idx').on(t.ownerId, t.status),
    check(
      'payouts_amounts',
      sql`${t.grossPaise} >= 0 AND ${t.commissionPaise} >= 0 AND ${t.netPaise} = ${t.grossPaise} - ${t.commissionPaise}`,
    ),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    /** Sequential per financial year, e.g. MB/2026-27/000123. */
    number: text('number').notNull(),
    storageKey: text('storage_key'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invoices_booking_key').on(t.bookingId),
    uniqueIndex('invoices_number_key').on(t.number),
  ],
);

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    /** The app booking reviewed, or null when it was a booking taken offline. */
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    offlineBookingId: uuid('offline_booking_id').references(() => offlineBookings.id, {
      onDelete: 'cascade',
    }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    auditoriumId: uuid('auditorium_id')
      .notNull()
      .references(() => auditoriums.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    body: text('body').notNull().default(''),
    status: reviewStatus('status').notNull().default('PUBLISHED'),
    ownerReply: text('owner_reply'),
    /** Who wrote it, as their account said when they did: kept even if the account changes. */
    reviewerName: text('reviewer_name').notNull(),
    reviewerEmail: citext('reviewer_email').notNull(),
    /** Null only on reviews written before a phone number was required. */
    reviewerPhone: text('reviewer_phone'),
    /** Date of the event reviewed (the first date for multi-day offline bookings). */
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('reviews_booking_key').on(t.bookingId),
    uniqueIndex('reviews_offline_booking_key').on(t.offlineBookingId),
    index('reviews_auditorium_idx').on(t.auditoriumId, t.createdAt),
    check('reviews_rating', sql`${t.rating} BETWEEN 1 AND 5`),
    check('reviews_body_length', sql`char_length(${t.body}) <= 4000`),
    check('reviews_one_booking', sql`(${t.bookingId} IS NULL) <> (${t.offlineBookingId} IS NULL)`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    channel: notificationChannel('channel').notNull(),
    template: text('template').notNull(),
    /** Non-sensitive template variables only. */
    data: jsonb('data').notNull().default({}),
    status: notificationStatus('status').notNull().default('QUEUED'),
    attempts: integer('attempts').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Prevents sending the same message twice (e.g. booking_confirmed:<bookingId>:<userId>). */
    dedupeKey: text('dedupe_key').notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_status_idx').on(t.status, t.createdAt),
    uniqueIndex('notifications_dedupe_key').on(t.dedupeKey),
    index('notifications_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'QUEUED'`),
  ],
);

/** Gap-free invoice numbering per Indian financial year (April-March), e.g. 2026-27. */
export const invoiceCounters = pgTable('invoice_counters', {
  financialYear: text('financial_year').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
});

/** Key/value platform configuration (commission, platform fee, GST rate). */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  ...timestamps(),
});
