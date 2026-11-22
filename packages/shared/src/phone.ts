import { z } from 'zod';

/** Indian mobile numbers: 10 digits starting 6-9, optional +91 / 91 / 0 prefix. */
const INDIAN_MOBILE = /^(?:\+91|91|0)?[6-9]\d{9}$/;

/** Normalise to E.164 (+91XXXXXXXXXX) or return null if not a valid Indian mobile. */
export function normalizeIndianMobile(input: string): string | null {
  const compact = input.replace(/[\s\-()]/g, '');
  if (!INDIAN_MOBILE.test(compact)) return null;
  return `+91${compact.slice(-10)}`;
}

export const indianMobileSchema = z
  .string()
  .trim()
  .max(20)
  .transform((value, ctx) => {
    const normalized = normalizeIndianMobile(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return normalized;
  });
