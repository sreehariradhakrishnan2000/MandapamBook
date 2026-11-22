import { z } from 'zod';
import { ROLES } from './rbac.js';

/** Reasons are shown to the owner, so they must say what to fix. */
export const decisionReasonSchema = z
  .string()
  .trim()
  .min(10, 'Explain what needs to change (at least 10 characters)')
  .max(1000);

export const listingDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approve') }),
  z.strictObject({ decision: z.literal('reject'), reason: decisionReasonSchema }),
  z.strictObject({ decision: z.literal('suspend'), reason: decisionReasonSchema }),
  z.strictObject({ decision: z.literal('reinstate') }),
]);
export type ListingDecision = z.infer<typeof listingDecisionSchema>;

export const kycDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('verify') }),
  z.strictObject({ decision: z.literal('reject'), reason: decisionReasonSchema }),
]);

export const kycRevealSchema = z.strictObject({
  /** Why the full numbers are needed; recorded in the audit log. */
  purpose: z.string().trim().min(5).max(200),
});

export const LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export const KYC_STATUSES = ['NOT_STARTED', 'SUBMITTED', 'VERIFIED', 'REJECTED'] as const;

const page = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
};

export const adminListingQuerySchema = z.strictObject({
  status: z.enum(LISTING_STATUSES).default('PENDING_REVIEW'),
  q: z.string().trim().max(100).optional(),
  ...page,
});

export const adminOwnerQuerySchema = z.strictObject({
  kycStatus: z.enum(KYC_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  ...page,
});

export const adminUserQuerySchema = z.strictObject({
  role: z.enum(ROLES).optional(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']).optional(),
  q: z.string().trim().max(100).optional(),
  ...page,
});

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
  .max(80);
const i18n = z
  .partialRecord(z.enum(['ml', 'hi', 'ta']), z.string().trim().min(1).max(120))
  .default({});

export const citySchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  slug,
  district: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  nameI18n: i18n,
  isActive: z.boolean().default(true),
});
export const cityUpdateSchema = citySchema.omit({ slug: true }).partial();

export const amenitySchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(80),
  icon: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .optional(),
  nameI18n: i18n,
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});
export const amenityUpdateSchema = amenitySchema.omit({ code: true }).partial();

export const muhurthamDateSchema = z.strictObject({
  date: z.iso.date(),
  label: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});

/**
 * Platform settings with their bounds. Rates are basis points (100 bp = 1%), amounts paise.
 * Changing them affects new quotes only; existing bookings keep their price snapshot.
 */
export const platformSettingsSchema = z.strictObject({
  commission_bps: z.number().int().min(0).max(3000),
  platform_fee_paise: z.number().int().min(0).max(1_000_000),
  gst_bps: z.number().int().min(0).max(2800),
  hold_minutes: z.number().int().min(5).max(30),
  owner_response_hours: z.number().int().min(1).max(72),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export const platformSettingsUpdateSchema = platformSettingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one setting');

/** Report window by event date (inclusive). Defaults to the current Indian financial year. */
export const reportQuerySchema = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'from must be on or before to')
  .refine(
    (q) => !q.from || !q.to || Date.parse(q.to) - Date.parse(q.from) <= 3 * 366 * 86_400_000,
    'Report window is limited to three years',
  );
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const payoutQuerySchema = z.object({
  status: z.enum(['PENDING', 'SCHEDULED', 'PAID', 'ON_HOLD']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const markPayoutPaidSchema = z.strictObject({
  /** Bank transfer reference (UTR) or similar. */
  reference: z
    .string()
    .trim()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9/_-]+$/, 'Letters, digits, / _ - only'),
});

export interface ReportSummary {
  from: string;
  to: string;
  bookingsByStatus: Record<string, number>;
  bookingValuePaise: number;
  collectedOnlinePaise: number;
  refundedPaise: number;
  platformFeesPaise: number;
  commissionPaise: number;
  payoutsPendingPaise: number;
  payoutsPaidPaise: number;
  topCities: { city: string; bookings: number; valuePaise: number }[];
}

export interface OwnerEarnings {
  from: string;
  to: string;
  bookings: number;
  bookingValuePaise: number;
  collectedOnlinePaise: number;
  commissionPaise: number;
  netPaise: number;
  paidOutPaise: number;
  pendingPaise: number;
}
