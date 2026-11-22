import { describe, expect, it } from 'vitest';
import { cancellationPolicySchema, ownerProfileSchema, pricingRuleSchema } from '../src/listing.js';

const profile = {
  businessName: 'Menon Event Spaces',
  pan: 'abcpm 1234f',
  bankAccountName: 'Menon Event Spaces',
  bankAccountNumber: '1234 5678 9012',
  ifsc: 'sbin0001234',
};

describe('ownerProfileSchema', () => {
  it('normalises PAN, IFSC and account number', () => {
    expect(ownerProfileSchema.parse(profile)).toMatchObject({
      pan: 'ABCPM1234F',
      ifsc: 'SBIN0001234',
      bankAccountNumber: '123456789012',
    });
  });

  it('rejects malformed PAN, IFSC and account numbers', () => {
    expect(ownerProfileSchema.safeParse({ ...profile, pan: 'ABCDE12345' }).success).toBe(false);
    expect(ownerProfileSchema.safeParse({ ...profile, ifsc: 'SBIN1001234' }).success).toBe(false);
    expect(ownerProfileSchema.safeParse({ ...profile, bankAccountNumber: '12345' }).success).toBe(
      false,
    );
  });

  it('requires the GSTIN to contain the PAN', () => {
    expect(ownerProfileSchema.safeParse({ ...profile, gstin: '32ABCPM1234F1Z5' }).success).toBe(
      true,
    );
    const other = ownerProfileSchema.safeParse({ ...profile, gstin: '32ZZZPM1234F1Z5' });
    expect(other.success).toBe(false);
  });
});

describe('cancellationPolicySchema', () => {
  it('sorts tiers and requires a 0-day tier', () => {
    const parsed = cancellationPolicySchema.parse({
      tiers: [
        { minDaysBefore: 0, refundPercent: 0 },
        { minDaysBefore: 30, refundPercent: 50 },
        { minDaysBefore: 60, refundPercent: 90 },
      ],
    });
    expect(parsed.tiers.map((t) => t.minDaysBefore)).toEqual([60, 30, 0]);
    expect(
      cancellationPolicySchema.safeParse({ tiers: [{ minDaysBefore: 30, refundPercent: 50 }] })
        .success,
    ).toBe(false);
  });

  it('rejects refunds that grow closer to the event', () => {
    const res = cancellationPolicySchema.safeParse({
      tiers: [
        { minDaysBefore: 30, refundPercent: 20 },
        { minDaysBefore: 0, refundPercent: 80 },
      ],
    });
    expect(res.success).toBe(false);
  });
});

describe('pricingRuleSchema', () => {
  it('requires dates for seasonal rules and integer paise', () => {
    expect(
      pricingRuleSchema.safeParse({ slot: 'MORNING', kind: 'SEASONAL', pricePaise: 100000 })
        .success,
    ).toBe(false);
    expect(
      pricingRuleSchema.safeParse({ slot: 'MORNING', kind: 'BASE', pricePaise: 1000.5 }).success,
    ).toBe(false);
    expect(
      pricingRuleSchema.safeParse({
        slot: 'FULL_DAY',
        kind: 'SEASONAL',
        validFrom: '2027-04-01',
        validTo: '2027-03-01',
        pricePaise: 100000,
      }).success,
    ).toBe(false);
  });
});
