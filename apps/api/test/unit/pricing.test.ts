import { describe, expect, it } from 'vitest';
import { daysBetween, previewRefund } from '../../src/modules/bookings/cancellation.js';
import {
  type PriceRule,
  dayOfWeek,
  quote,
  resolvePriceRule,
} from '../../src/modules/bookings/pricing.js';

const rule = (over: Partial<PriceRule>): PriceRule => ({
  id: over.kind ?? 'BASE',
  slot: 'MORNING',
  kind: 'BASE',
  validFrom: null,
  validTo: null,
  pricePaise: 10_000_000,
  priority: 0,
  ...over,
});

describe('resolvePriceRule', () => {
  const rules = [
    rule({ id: 'base', kind: 'BASE', pricePaise: 10_000_000, priority: 0 }),
    rule({ id: 'weekend', kind: 'WEEKEND', pricePaise: 11_000_000, priority: 10 }),
    rule({
      id: 'season',
      kind: 'SEASONAL',
      validFrom: '2027-04-01',
      validTo: '2027-05-31',
      pricePaise: 12_000_000,
      priority: 20,
    }),
    rule({ id: 'muhurtham', kind: 'MUHURTHAM', pricePaise: 13_500_000, priority: 30 }),
    rule({
      id: 'override',
      kind: 'DATE_OVERRIDE',
      validFrom: '2027-05-10',
      validTo: '2027-05-10',
      pricePaise: 9_000_000,
      priority: 40,
    }),
    rule({ id: 'evening', slot: 'EVENING', pricePaise: 8_000_000 }),
  ];
  const muhurtham = new Set(['2027-04-26', '2027-05-10']);

  it('uses the base price on an ordinary weekday', () => {
    expect(dayOfWeek('2027-03-03')).toBe(3); // Wednesday
    expect(resolvePriceRule(rules, '2027-03-03', 'MORNING', muhurtham)?.id).toBe('base');
  });

  it('applies weekend, season, muhurtham and date overrides in priority order', () => {
    expect(resolvePriceRule(rules, '2027-03-06', 'MORNING', muhurtham)?.id).toBe('weekend'); // Saturday
    expect(resolvePriceRule(rules, '2027-04-07', 'MORNING', muhurtham)?.id).toBe('season');
    expect(resolvePriceRule(rules, '2027-04-26', 'MORNING', muhurtham)?.id).toBe('muhurtham');
    expect(resolvePriceRule(rules, '2027-05-10', 'MORNING', muhurtham)?.id).toBe('override');
  });

  it('only looks at the requested slot and returns null when there is no price', () => {
    expect(resolvePriceRule(rules, '2027-03-03', 'EVENING', muhurtham)?.id).toBe('evening');
    expect(resolvePriceRule(rules, '2027-03-03', 'FULL_DAY', muhurtham)).toBeNull();
  });

  it('breaks ties by kind, then by the higher price', () => {
    const tied = [
      rule({
        id: 'a',
        kind: 'SEASONAL',
        validFrom: '2027-01-01',
        validTo: '2027-12-31',
        priority: 5,
        pricePaise: 100,
      }),
      rule({
        id: 'b',
        kind: 'SEASONAL',
        validFrom: '2027-01-01',
        validTo: '2027-12-31',
        priority: 5,
        pricePaise: 200,
      }),
      rule({ id: 'c', kind: 'WEEKEND', priority: 5, pricePaise: 999 }),
    ];
    expect(resolvePriceRule(tied, '2027-03-03', 'MORNING', new Set())?.id).toBe('b');
  });
});

describe('quote', () => {
  it('computes GST on venue charges and an advance that excludes the platform fee', () => {
    const q = quote({
      basePaise: 14_000_000, // ₹1,40,000
      addons: [
        { addonId: 'a1', code: 'guest_room', name: 'Guest room', quantity: 4, unitPaise: 250_000 },
        { addonId: 'a2', code: 'sound', name: 'Sound', quantity: 1, unitPaise: 1_200_000 },
      ],
      gstBasisPoints: 1800,
      platformFeePaise: 49_900,
      advancePercent: 25,
    });
    expect(q.addonsPaise).toBe(2_200_000);
    expect(q.venueChargesPaise).toBe(16_200_000);
    expect(q.gstPaise).toBe(2_916_000);
    expect(q.totalPaise).toBe(16_200_000 + 2_916_000 + 49_900);
    expect(q.venueAdvancePaise).toBe(4_779_000); // 25% of 1,91,16,000 paise
    expect(q.payNowPaise).toBe(4_779_000 + 49_900);
    expect(q.payNowPaise + q.payLaterPaise).toBe(q.totalPaise);
  });

  it('rounds half up and stays in integers', () => {
    const q = quote({
      basePaise: 333,
      addons: [],
      gstBasisPoints: 1800,
      platformFeePaise: 0,
      advancePercent: 33,
    });
    expect(q.gstPaise).toBe(60); // 59.94
    expect(Number.isInteger(q.venueAdvancePaise)).toBe(true);
  });

  it('rejects invalid inputs', () => {
    const base = { basePaise: 100, addons: [], gstBasisPoints: 1800, platformFeePaise: 0 };
    expect(() => quote({ ...base, advancePercent: 5 })).toThrow();
    expect(() => quote({ ...base, basePaise: 1.5, advancePercent: 25 })).toThrow();
    expect(() =>
      quote({
        ...base,
        advancePercent: 25,
        addons: [{ addonId: 'x', code: 'x', name: 'x', quantity: 0, unitPaise: 1 }],
      }),
    ).toThrow();
  });
});

describe('cancellation refunds', () => {
  const tiers = [
    { minDaysBefore: 60, refundPercent: 90 },
    { minDaysBefore: 30, refundPercent: 50 },
    { minDaysBefore: 0, refundPercent: 0 },
  ];

  it('counts calendar days across month and year boundaries', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
  });

  it('applies the matching tier to the venue advance and never refunds the platform fee', () => {
    const r = previewRefund({
      tiers,
      today: '2027-01-01',
      eventDate: '2027-03-15',
      paidPaise: 1_049_900,
      platformFeePaise: 49_900,
    });
    expect(r.daysBeforeEvent).toBe(73);
    expect(r.refundPercent).toBe(90);
    expect(r.refundPaise).toBe(900_000);
    expect(r.retainedPaise).toBe(149_900);

    expect(
      previewRefund({
        tiers,
        today: '2027-02-20',
        eventDate: '2027-03-15',
        paidPaise: 1_049_900,
        platformFeePaise: 49_900,
      }).refundPercent,
    ).toBe(0);
    expect(
      previewRefund({
        tiers,
        today: '2027-02-01',
        eventDate: '2027-03-15',
        paidPaise: 1_049_900,
        platformFeePaise: 49_900,
      }).refundPaise,
    ).toBe(500_000);
  });

  it('refunds nothing when nothing was paid', () => {
    expect(
      previewRefund({
        tiers,
        today: '2027-01-01',
        eventDate: '2027-03-15',
        paidPaise: 0,
        platformFeePaise: 49_900,
      }),
    ).toMatchObject({ refundPaise: 0, retainedPaise: 0 });
  });
});
