import { describe, expect, it } from 'vitest';
import { indianMobileSchema, normalizeIndianMobile } from '../src/phone.js';

describe('Indian mobile validation', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['91-98765-43210', '+919876543210'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each(['5876543210', '987654321', '+1 9876543210', 'abcdefghij'])('rejects %s', (input) => {
    expect(normalizeIndianMobile(input)).toBeNull();
  });

  it('works as a zod schema', () => {
    expect(indianMobileSchema.parse('9876543210')).toBe('+919876543210');
    expect(indianMobileSchema.safeParse('123').success).toBe(false);
  });
});
