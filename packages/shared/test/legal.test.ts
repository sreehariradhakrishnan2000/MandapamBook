import { describe, expect, it } from 'vitest';
import { registerSchema } from '../src/auth.js';
import { acceptTermsSchema, describeRefundTiers } from '../src/legal.js';

describe('terms acceptance', () => {
  it('passes only an explicit true', () => {
    expect(acceptTermsSchema.safeParse(true).success).toBe(true);
    for (const v of [false, undefined, 'true', 1]) {
      expect(acceptTermsSchema.safeParse(v).success).toBe(false);
    }
  });

  it('is required to sign up', () => {
    const base = { email: 'a@example.com', password: 'long enough pw', fullName: 'Asha' };
    expect(registerSchema.safeParse(base).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, acceptTerms: true }).success).toBe(true);
  });
});

describe('describeRefundTiers', () => {
  it('turns tiers into day ranges, nearest last', () => {
    expect(
      describeRefundTiers([
        { minDaysBefore: 0, refundPercent: 0 },
        { minDaysBefore: 30, refundPercent: 50 },
        { minDaysBefore: 60, refundPercent: 90 },
        { minDaysBefore: 7, refundPercent: 25 },
      ]),
    ).toEqual([
      '60 or more days before the event: 90% of the advance back',
      '30 to 59 days before: 50% of the advance back',
      '7 to 29 days before: 25% of the advance back',
      'Less than 7 days before: no refund',
    ]);
  });

  it('adds the uncovered days as no refund', () => {
    expect(describeRefundTiers([{ minDaysBefore: 14, refundPercent: 100 }])).toEqual([
      '14 or more days before the event: 100% of the advance back',
      'Less than 14 days before: no refund',
    ]);
  });

  it('says so when a venue has no tiers', () => {
    expect(describeRefundTiers([])).toEqual(['Cancelling gives no refund of the advance']);
  });
});
