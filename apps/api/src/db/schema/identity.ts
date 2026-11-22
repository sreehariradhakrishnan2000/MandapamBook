import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { emailTokenPurpose, kycStatus, otpPurpose, userRole, userStatus } from './enums.js';
import { bytea, citext, createdAt, id, inet, timestamps } from './types.js';

export const users = pgTable(
  'users',
  {
    id: id(),
    email: citext('email').notNull(),
    /** E.164, e.g. +919876543210 */
    phone: text('phone'),
    fullName: text('full_name').notNull(),
    /** argon2id hash; null until the user sets a password (e.g. invited staff). */
    passwordHash: text('password_hash'),
    role: userRole('role').notNull().default('CUSTOMER'),
    status: userStatus('status').notNull().default('PENDING_VERIFICATION'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Bumped on role/permission change so outstanding access tokens can be rejected. */
    permissionsVersion: integer('permissions_version').notNull().default(1),
    preferredLocale: text('preferred_locale').notNull().default('en'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    uniqueIndex('users_phone_key')
      .on(t.phone)
      .where(sql`${t.phone} IS NOT NULL`),
    check('users_phone_e164', sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`),
    check('users_locale', sql`${t.preferredLocale} IN ('en', 'ml', 'hi', 'ta')`),
    check('users_failed_login_count', sql`${t.failedLoginCount} >= 0`),
  ],
);

export const ownerProfiles = pgTable(
  'owner_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    businessName: text('business_name').notNull(),
    /** AES-256-GCM ciphertext (key version + iv + tag + data). */
    panEnc: bytea('pan_enc'),
    /** Last 4 characters only, for display. */
    panLast4: text('pan_last4'),
    gstin: text('gstin'),
    bankAccountEnc: bytea('bank_account_enc'),
    bankAccountLast4: text('bank_account_last4'),
    ifscEnc: bytea('ifsc_enc'),
    bankAccountName: text('bank_account_name'),
    kycStatus: kycStatus('kyc_status').notNull().default('NOT_STARTED'),
    kycReviewedBy: uuid('kyc_reviewed_by').references(() => users.id),
    kycReviewedAt: timestamp('kyc_reviewed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check(
      'owner_profiles_gstin_format',
      sql`${t.gstin} IS NULL OR ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
  ],
);

/** OWNER_STAFF users and which owner they work for. */
export const ownerStaff = pgTable(
  'owner_staff',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => ownerProfiles.userId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Optional restriction to specific auditoriums; empty means all of the owner's venues. */
    auditoriumIds: uuid('auditorium_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    invitedBy: uuid('invited_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.userId] }),
    uniqueIndex('owner_staff_user_key').on(t.userId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    /** HMAC-SHA256 of the opaque token; the token itself is never stored. */
    tokenHash: bytea('token_hash').notNull(),
    deviceInfo: text('device_info'),
    ip: inet('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    replacedBy: uuid('replaced_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurpose('purpose').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('email_tokens_hash_key').on(t.tokenHash)],
);

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    purpose: otpPurpose('purpose').notNull(),
    codeHash: bytea('code_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('otp_challenges_phone_idx').on(t.phone, t.createdAt),
    check('otp_challenges_attempts', sql`${t.attempts} BETWEEN 0 AND 10`),
  ],
);

/**
 * Append-only record of sensitive actions. UPDATE and DELETE are blocked by a trigger
 * (see the custom migration), so rows cannot be altered even by the app role.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: userRole('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    correlationId: text('correlation_id'),
    success: boolean('success').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('audit_logs_actor_idx').on(t.actorId, t.createdAt),
    index('audit_logs_action_idx').on(t.action, t.createdAt),
  ],
);
