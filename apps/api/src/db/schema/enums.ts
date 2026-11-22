import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', [
  'SUPER_ADMIN',
  'ADMIN',
  'OWNER',
  'OWNER_STAFF',
  'CUSTOMER',
]);
export const userStatus = pgEnum('user_status', ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']);
export const kycStatus = pgEnum('kyc_status', ['NOT_STARTED', 'SUBMITTED', 'VERIFIED', 'REJECTED']);

export const listingStatus = pgEnum('listing_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);
export const cateringPolicy = pgEnum('catering_policy', [
  'IN_HOUSE_ONLY',
  'OUTSIDE_ALLOWED',
  'NO_CATERING',
]);
export const decorationPolicy = pgEnum('decoration_policy', [
  'IN_HOUSE_ONLY',
  'OUTSIDE_ALLOWED',
  'NOT_ALLOWED',
]);
export const mediaStatus = pgEnum('media_status', ['PENDING_UPLOAD', 'READY', 'REJECTED']);
export const addonUnit = pgEnum('addon_unit', ['PER_EVENT', 'PER_ROOM', 'PER_HOUR']);

/** Muhurtham = morning, Reception = evening, Full day covers both. */
export const bookingSlot = pgEnum('booking_slot', ['MORNING', 'EVENING', 'FULL_DAY']);
export const pricingRuleKind = pgEnum('pricing_rule_kind', [
  'BASE',
  'WEEKEND',
  'SEASONAL',
  'MUHURTHAM',
  'DATE_OVERRIDE',
]);

export const bookingStatus = pgEnum('booking_status', [
  'HELD',
  'PENDING_PAYMENT',
  'AWAITING_OWNER',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
]);

/** Statuses that occupy a hall slot. Keep in sync with sync_booking_occupancy() in SQL. */
export const ACTIVE_BOOKING_STATUSES = [
  'HELD',
  'PENDING_PAYMENT',
  'AWAITING_OWNER',
  'CONFIRMED',
  'COMPLETED',
] as const;

export const paymentStatus = pgEnum('payment_status', [
  'CREATED',
  'PENDING',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);
export const refundStatus = pgEnum('refund_status', ['PENDING', 'PROCESSED', 'FAILED']);
export const payoutStatus = pgEnum('payout_status', ['PENDING', 'SCHEDULED', 'PAID', 'ON_HOLD']);
export const reviewStatus = pgEnum('review_status', ['PUBLISHED', 'HIDDEN', 'FLAGGED']);
export const notificationChannel = pgEnum('notification_channel', ['EMAIL', 'SMS']);
export const notificationStatus = pgEnum('notification_status', ['QUEUED', 'SENT', 'FAILED']);
export const otpPurpose = pgEnum('otp_purpose', ['PHONE_VERIFY', 'LOGIN', 'PASSWORD_RESET']);
export const emailTokenPurpose = pgEnum('email_token_purpose', ['VERIFY_EMAIL', 'PASSWORD_RESET']);
