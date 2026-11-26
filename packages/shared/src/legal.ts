import { z } from 'zod';

/**
 * Version of the Terms of Use and Refund & Cancellation Policy that people agree to at
 * sign-up and before paying. Change it whenever those pages change in substance; each
 * acceptance is recorded in the audit log with this version.
 */
export const TERMS_VERSION = '2026-11-27';

/** A required "I agree" tick: only `true` passes. */
export const acceptTermsSchema = z.literal(true, {
  error: 'Accept the Terms of Use and the Refund & Cancellation Policy to continue',
});

export interface RefundTier {
  minDaysBefore: number;
  refundPercent: number;
}

/**
 * Plain-language lines for a venue's cancellation tiers, nearest-to-furthest last, e.g.
 * "60 or more days before the event: 90% of the advance back". Days not covered by any
 * tier (closer than the smallest minDaysBefore) get "no refund".
 */
export function describeRefundTiers(tiers: readonly RefundTier[]): string[] {
  const sorted = [...tiers].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  const back = (p: number) => (p > 0 ? `${p}% of the advance back` : 'no refund');
  const lines = sorted.map((t, i) => {
    const prev = sorted[i - 1];
    if (!prev) return `${t.minDaysBefore} or more days before the event: ${back(t.refundPercent)}`;
    const upper = prev.minDaysBefore - 1;
    const range =
      t.minDaysBefore === 0
        ? `Less than ${prev.minDaysBefore} days before`
        : upper === t.minDaysBefore
          ? `${t.minDaysBefore} days before`
          : `${t.minDaysBefore} to ${upper} days before`;
    return `${range}: ${back(t.refundPercent)}`;
  });
  const last = sorted.at(-1);
  if (!last) return ['Cancelling gives no refund of the advance'];
  if (last.minDaysBefore > 0) lines.push(`Less than ${last.minDaysBefore} days before: no refund`);
  return lines;
}
