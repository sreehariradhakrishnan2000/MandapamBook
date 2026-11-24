import { z } from 'zod';
import { patchSchema } from './patch.js';
import { emailSchema, fullNameSchema } from './auth.js';
import { indianMobileSchema } from './phone.js';

// ---------------------------------------------------------------- KYC

/** PAN: 5 letters, 4 digits, 1 letter (4th letter encodes holder type). */
export const PAN_PATTERN = /^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/;
/** GSTIN: 2-digit state code + PAN + entity number + 'Z' + checksum. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** IFSC: 4-letter bank code, 0, 6-character branch code. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const upper = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');

export const ownerProfileSchema = z
  .strictObject({
    businessName: z.string().trim().min(2).max(160),
    pan: z
      .string()
      .transform(upper)
      .pipe(z.string().regex(PAN_PATTERN, 'Enter a valid 10-character PAN, e.g. ABCPE1234F')),
    gstin: z
      .string()
      .transform(upper)
      .pipe(z.string().regex(GSTIN_PATTERN, 'Enter a valid 15-character GSTIN'))
      .optional(),
    bankAccountName: z.string().trim().min(2).max(120),
    bankAccountNumber: z
      .string()
      .transform((s) => s.replace(/\s+/g, ''))
      .pipe(z.string().regex(/^\d{9,18}$/, 'Account numbers have 9 to 18 digits')),
    ifsc: z
      .string()
      .transform(upper)
      .pipe(z.string().regex(IFSC_PATTERN, 'Enter a valid IFSC, e.g. SBIN0001234')),
  })
  .refine((v) => !v.gstin || v.gstin.slice(2, 12) === v.pan, {
    path: ['gstin'],
    message: 'The GSTIN must contain your PAN',
  });
export type OwnerProfileInput = z.input<typeof ownerProfileSchema>;

/** Never contains full PAN or account number: only what is safe to display. */
export interface OwnerProfileView {
  businessName: string;
  panMasked: string | null;
  gstin: string | null;
  bankAccountName: string | null;
  bankAccountMasked: string | null;
  ifsc: string | null;
  kycStatus: 'NOT_STARTED' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
  /** Set when an admin rejected the details; cleared when the owner saves them again. */
  kycRejectionReason: string | null;
}

// ---------------------------------------------------------------- listings

export const SLOTS = ['MORNING', 'EVENING', 'FULL_DAY'] as const;
export const slotSchema = z.enum(SLOTS);
export type Slot = z.infer<typeof slotSchema>;

const paise = z.number().int().nonnegative().max(1_000_000_000_00);
const isoDate = z.iso.date();

export const auditoriumSchema = z.strictObject({
  name: z.string().trim().min(3).max(120),
  cityId: z.uuid(),
  description: z.string().trim().max(4000).default(''),
  addressLine: z.string().trim().min(5).max(300),
  locality: z.string().trim().max(120).optional(),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Enter a 6-digit PIN code'),
  latitude: z.number().min(6).max(37).optional(),
  longitude: z.number().min(68).max(98).optional(),
  cateringPolicy: z.enum(['IN_HOUSE_ONLY', 'OUTSIDE_ALLOWED', 'NO_CATERING']),
  decorationPolicy: z.enum(['IN_HOUSE_ONLY', 'OUTSIDE_ALLOWED', 'NOT_ALLOWED']),
  parkingCars: z.number().int().min(0).max(5000).default(0),
  parkingTwoWheelers: z.number().int().min(0).max(10000).default(0),
  guestRooms: z.number().int().min(0).max(500).default(0),
  hasGenerator: z.boolean().default(false),
  sadyaPrepArea: z.boolean().default(false),
  cookingEquipment: z.boolean().default(false),
  advancePercent: z.number().int().min(10).max(100).default(25),
  instantBook: z.boolean().default(true),
});
export const auditoriumUpdateSchema = patchSchema(auditoriumSchema);
export type AuditoriumInput = z.input<typeof auditoriumSchema>;

export const hallSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  seatingCapacity: z.number().int().min(1).max(20000),
  diningCapacity: z.number().int().min(0).max(20000).default(0),
  isAc: z.boolean().default(false),
  diningIsAc: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const hallUpdateSchema = patchSchema(hallSchema);

export const amenitiesSchema = z.strictObject({
  codes: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(50),
});

export const addonSchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  unit: z.enum(['PER_EVENT', 'PER_ROOM', 'PER_HOUR']).default('PER_EVENT'),
  pricePaise: paise,
  maxQuantity: z.number().int().min(1).max(500).default(1),
  isActive: z.boolean().default(true),
});
export const addonUpdateSchema = patchSchema(addonSchema.omit({ code: true }));

export const cancellationPolicySchema = z.strictObject({
  tiers: z
    .array(
      z.strictObject({
        minDaysBefore: z.number().int().min(0).max(365),
        refundPercent: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(10)
    .refine(
      (t) => new Set(t.map((x) => x.minDaysBefore)).size === t.length,
      'Each tier needs a different number of days',
    )
    .refine(
      (t) => t.some((x) => x.minDaysBefore === 0),
      'Add a tier for 0 days (cancellations close to the event)',
    )
    .transform((t) => [...t].sort((a, b) => b.minDaysBefore - a.minDaysBefore))
    .refine(
      (t) => t.every((x, i) => x.refundPercent <= (t[i - 1]?.refundPercent ?? 100)),
      'Refunds cannot increase closer to the event',
    ),
  notes: z.string().trim().max(1000).default(''),
});

export const pricingRuleSchema = z
  .strictObject({
    slot: slotSchema,
    kind: z.enum(['BASE', 'WEEKEND', 'SEASONAL', 'MUHURTHAM', 'DATE_OVERRIDE']),
    validFrom: isoDate.optional(),
    validTo: isoDate.optional(),
    pricePaise: paise.min(100),
    priority: z.number().int().min(0).max(100).optional(),
    label: z.string().trim().max(60).optional(),
  })
  .refine((r) => !['SEASONAL', 'DATE_OVERRIDE'].includes(r.kind) || (r.validFrom && r.validTo), {
    message: 'Seasonal and date prices need a start and end date',
    path: ['validFrom'],
  })
  .refine((r) => !r.validFrom || !r.validTo || r.validFrom <= r.validTo, {
    message: 'The end date must be on or after the start date',
    path: ['validTo'],
  });

/** Default priorities so more specific rules win: date > muhurtham > seasonal > weekend > base. */
export const DEFAULT_RULE_PRIORITY = {
  BASE: 0,
  WEEKEND: 10,
  SEASONAL: 20,
  MUHURTHAM: 30,
  DATE_OVERRIDE: 40,
} as const;

export const blockSchema = z.strictObject({
  eventDate: isoDate,
  slot: slotSchema,
  reason: z.string().trim().max(200).optional(),
});

/** Details an owner keeps about a booking taken outside the app (phone, walk-in). */
const offlineDetails = {
  customerName: fullNameSchema,
  customerPhone: indianMobileSchema,
  customerEmail: emailSchema.optional(),
  eventType: z.string().trim().min(1).max(80).optional(),
  amountPaise: paise.optional(),
  advancePaise: paise.optional(),
  notes: z.string().trim().max(1000).optional(),
};
const advanceWithinAmount = (v: {
  amountPaise?: number | undefined;
  advancePaise?: number | undefined;
}) =>
  v.amountPaise === undefined || v.advancePaise === undefined || v.advancePaise <= v.amountPaise;

export const offlineBookingSchema = z
  .strictObject({
    hallId: z.uuid(),
    /** One booking can hold several days or slots (e.g. engagement and wedding). */
    slots: z
      .array(z.strictObject({ eventDate: isoDate, slot: slotSchema }))
      .min(1)
      .max(31)
      .refine(
        (s) => new Set(s.map((x) => `${x.eventDate}:${x.slot}`)).size === s.length,
        'Each date and slot can appear once',
      ),
    ...offlineDetails,
  })
  .refine(advanceWithinAmount, {
    path: ['advancePaise'],
    message: 'The advance cannot be more than the amount',
  });
export type OfflineBookingInput = z.input<typeof offlineBookingSchema>;

/** Editing an offline booking changes its details only; to move dates, cancel and re-add. */
export const offlineBookingUpdateSchema = patchSchema(z.strictObject(offlineDetails)).refine(
  advanceWithinAmount,
  { path: ['advancePaise'], message: 'The advance cannot be more than the amount' },
);

export const staffInviteSchema = z.strictObject({
  email: emailSchema,
  fullName: fullNameSchema,
  auditoriumIds: z.array(z.uuid()).max(100).default([]),
});
export const staffUpdateSchema = z.strictObject({ auditoriumIds: z.array(z.uuid()).max(100) });

export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_MAX_PER_VENUE = 30;

export const mediaUploadSchema = z.strictObject({
  mimeType: z.enum(MEDIA_TYPES),
  sizeBytes: z.number().int().min(1).max(MEDIA_MAX_BYTES),
  altText: z.string().trim().max(200).default(''),
});
export const mediaUpdateSchema = z.strictObject({
  altText: z.string().trim().max(200).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
