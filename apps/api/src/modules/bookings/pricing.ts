/**
 * Pure pricing functions. No I/O, so every rule here is covered by fast unit tests.
 * All amounts are integer paise; rates are basis points.
 */
import { applyBasisPoints, assertPaise, sumPaise } from '@mandapambook/shared';

export type Slot = 'MORNING' | 'EVENING' | 'FULL_DAY';
export type RuleKind = 'BASE' | 'WEEKEND' | 'SEASONAL' | 'MUHURTHAM' | 'DATE_OVERRIDE';

export interface PriceRule {
  id: string;
  slot: Slot;
  kind: RuleKind;
  validFrom: string | null;
  validTo: string | null;
  pricePaise: number;
  priority: number;
}

/** Tie-breaker when two rules share a priority: more specific kinds win. */
const KIND_RANK: Record<RuleKind, number> = {
  BASE: 0,
  WEEKEND: 1,
  SEASONAL: 2,
  MUHURTHAM: 3,
  DATE_OVERRIDE: 4,
};

/** Day of week for a calendar date (0 = Sunday), independent of the server's timezone. */
export function dayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(isoDate: string): boolean {
  const dow = dayOfWeek(isoDate);
  return dow === 0 || dow === 6;
}

function applies(rule: PriceRule, date: string, muhurtham: ReadonlySet<string>): boolean {
  switch (rule.kind) {
    case 'BASE':
      return true;
    case 'WEEKEND':
      return isWeekend(date);
    case 'MUHURTHAM':
      return muhurtham.has(date);
    case 'SEASONAL':
    case 'DATE_OVERRIDE':
      return (
        rule.validFrom !== null &&
        rule.validTo !== null &&
        rule.validFrom <= date &&
        date <= rule.validTo
      );
  }
}

/**
 * The rule that prices a hall slot on a date: the highest-priority applicable rule for
 * that slot, then the more specific kind, then the higher price (never undercharge on a tie).
 * Returns null when the hall has no price for the slot.
 */
export function resolvePriceRule(
  rules: readonly PriceRule[],
  date: string,
  slot: Slot,
  muhurthamDates: ReadonlySet<string>,
): PriceRule | null {
  let best: PriceRule | null = null;
  for (const r of rules) {
    if (r.slot !== slot || !applies(r, date, muhurthamDates)) continue;
    if (
      !best ||
      r.priority > best.priority ||
      (r.priority === best.priority && KIND_RANK[r.kind] > KIND_RANK[best.kind]) ||
      (r.priority === best.priority &&
        KIND_RANK[r.kind] === KIND_RANK[best.kind] &&
        r.pricePaise > best.pricePaise)
    ) {
      best = r;
    }
  }
  return best;
}

export interface AddonLine {
  addonId: string;
  code: string;
  name: string;
  quantity: number;
  unitPaise: number;
}

export interface QuoteInput {
  basePaise: number;
  addons: readonly AddonLine[];
  gstBasisPoints: number;
  platformFeePaise: number;
  /** Owner's advance percentage (10-100) of venue charges + GST. */
  advancePercent: number;
}

export interface Quote {
  basePaise: number;
  addons: (AddonLine & { totalPaise: number })[];
  addonsPaise: number;
  /** base + add-ons: what the venue charges. */
  venueChargesPaise: number;
  gstPaise: number;
  platformFeePaise: number;
  totalPaise: number;
  /** Venue share of the advance: advance% of (venue charges + GST). */
  venueAdvancePaise: number;
  /** Collected online now = venue advance + platform fee. */
  payNowPaise: number;
  /** Paid at the venue later. */
  payLaterPaise: number;
}

/**
 * Price breakdown. GST applies to venue charges; the platform fee is GST-inclusive and is
 * always collected online. Rounding is half-up per step, on integers only.
 */
export function quote(input: QuoteInput): Quote {
  assertPaise(input.basePaise, 'basePaise');
  assertPaise(input.platformFeePaise, 'platformFeePaise');
  if (
    !Number.isInteger(input.advancePercent) ||
    input.advancePercent < 10 ||
    input.advancePercent > 100
  ) {
    throw new RangeError('advancePercent must be an integer between 10 and 100');
  }
  const addons = input.addons.map((a) => {
    if (!Number.isInteger(a.quantity) || a.quantity < 1)
      throw new RangeError(`invalid quantity for ${a.code}`);
    assertPaise(a.unitPaise, a.code);
    return { ...a, totalPaise: a.unitPaise * a.quantity };
  });
  const addonsPaise = sumPaise(0, ...addons.map((a) => a.totalPaise));
  const venueChargesPaise = sumPaise(input.basePaise, addonsPaise);
  const gstPaise = applyBasisPoints(venueChargesPaise, input.gstBasisPoints);
  const totalPaise = sumPaise(venueChargesPaise, gstPaise, input.platformFeePaise);
  const venueAdvancePaise = applyBasisPoints(
    sumPaise(venueChargesPaise, gstPaise),
    input.advancePercent * 100,
  );
  const payNowPaise = sumPaise(venueAdvancePaise, input.platformFeePaise);
  return {
    basePaise: input.basePaise,
    addons,
    addonsPaise,
    venueChargesPaise,
    gstPaise,
    platformFeePaise: input.platformFeePaise,
    totalPaise,
    venueAdvancePaise,
    payNowPaise,
    payLaterPaise: totalPaise - payNowPaise,
  };
}
