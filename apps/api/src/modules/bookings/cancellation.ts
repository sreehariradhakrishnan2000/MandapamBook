import { applyBasisPoints } from '@mandapambook/shared';

export interface CancellationTier {
  minDaysBefore: number;
  refundPercent: number;
}

export interface RefundPreview {
  daysBeforeEvent: number;
  refundPercent: number;
  /** Amount returned to the customer, in paise. */
  refundPaise: number;
  /** Paid online and kept (venue share not refunded + platform fee). */
  retainedPaise: number;
  /** Human-readable rule that applied. */
  rule: string;
}

/** Whole calendar days from `today` to `eventDate` (both YYYY-MM-DD, IST). */
export function daysBetween(today: string, eventDate: string): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUtc(eventDate) - toUtc(today)) / 86_400_000);
}

/**
 * Refund for cancelling a paid booking. The venue's tier applies to the venue advance;
 * the platform fee is never refunded. If nothing was paid yet, nothing is refunded or kept.
 */
export function previewRefund(input: {
  tiers: readonly CancellationTier[];
  today: string;
  eventDate: string;
  paidPaise: number;
  platformFeePaise: number;
}): RefundPreview {
  const daysBeforeEvent = daysBetween(input.today, input.eventDate);
  if (input.paidPaise <= 0) {
    return {
      daysBeforeEvent,
      refundPercent: 0,
      refundPaise: 0,
      retainedPaise: 0,
      rule: 'Nothing has been paid yet',
    };
  }
  const sorted = [...input.tiers].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  const tier = sorted.find((t) => daysBeforeEvent >= t.minDaysBefore);
  const refundPercent = tier?.refundPercent ?? 0;
  const refundable = Math.max(0, input.paidPaise - input.platformFeePaise);
  const refundPaise = applyBasisPoints(refundable, refundPercent * 100);
  return {
    daysBeforeEvent,
    refundPercent,
    refundPaise,
    retainedPaise: input.paidPaise - refundPaise,
    rule: tier
      ? `${refundPercent}% of the venue advance when cancelling ${tier.minDaysBefore}+ days before`
      : 'No refund this close to the event',
  };
}
