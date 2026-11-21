import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  applyBasisPoints,
  assertPaise,
  formatInr,
  rupeesToPaise,
  sumPaise,
} from '../src/money.js';

describe('money', () => {
  it('rejects non-integer paise', () => {
    expect(() => assertPaise(10.5)).toThrow(MoneyError);
    expect(() => assertPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => assertPaise(100)).not.toThrow();
  });

  it('converts rupees with at most 2 decimals', () => {
    expect(rupeesToPaise(1250.75)).toBe(125075);
    expect(rupeesToPaise(0.1)).toBe(10);
    expect(() => rupeesToPaise(1.005)).toThrow(MoneyError);
  });

  it('applies basis points with half-up rounding', () => {
    expect(applyBasisPoints(100000, 1800)).toBe(18000); // 18% GST on ₹1000
    expect(applyBasisPoints(333, 1800)).toBe(60); // 59.94 → 60
    expect(applyBasisPoints(25, 1000)).toBe(3); // 2.5 → 3
    expect(applyBasisPoints(-25, 1000)).toBe(-3);
  });

  it('sums safely', () => {
    expect(sumPaise(100, 200, 300)).toBe(600);
    expect(() => sumPaise(1.5)).toThrow(MoneyError);
  });

  it('formats INR with Indian grouping', () => {
    expect(formatInr(12500000)).toBe('₹1,25,000.00');
  });
});
