/**
 * All money in MandapamBook is an integer number of paise (1 INR = 100 paise).
 * Floats are never used for amounts. These helpers guard that invariant.
 */
export type Paise = number;

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function assertPaise(value: number, label = 'amount'): asserts value is Paise {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer number of paise, got ${value}`);
  }
}

export function rupeesToPaise(rupees: number): Paise {
  // Accepts at most 2 decimal places; rejects values that would need rounding.
  const paise = Math.round(rupees * 100);
  if (Math.abs(paise - rupees * 100) > 1e-6) {
    throw new MoneyError(`rupee value ${rupees} has more than 2 decimal places`);
  }
  assertPaise(paise);
  return paise;
}

/**
 * Apply a rate expressed in basis points (1 bp = 0.01%) to an amount,
 * rounding half away from zero to the nearest paisa.
 */
export function applyBasisPoints(amount: Paise, basisPoints: number): Paise {
  assertPaise(amount);
  if (!Number.isSafeInteger(basisPoints)) throw new MoneyError('basisPoints must be an integer');
  const numerator = BigInt(amount) * BigInt(basisPoints);
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator * sign;
  const rounded = (abs + 5000n) / 10000n;
  const result = Number(rounded * sign);
  assertPaise(result);
  return result;
}

export function sumPaise(...amounts: Paise[]): Paise {
  let total = 0;
  for (const a of amounts) {
    assertPaise(a);
    total += a;
  }
  assertPaise(total, 'total');
  return total;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format paise as Indian rupees with lakh/crore grouping, e.g. ₹1,25,000.00 */
export function formatInr(amount: Paise): string {
  assertPaise(amount);
  return inrFormatter.format(amount / 100);
}
