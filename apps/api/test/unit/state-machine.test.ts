import { describe, expect, it } from 'vitest';
import {
  type BookingStatus,
  IllegalTransitionError,
  TRANSITIONS,
  assertTransition,
  canTransition,
} from '../../src/modules/bookings/state-machine.js';

const ALL: BookingStatus[] = [
  'HELD',
  'PENDING_PAYMENT',
  'AWAITING_OWNER',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
];

describe('booking state machine', () => {
  it('allows the happy paths', () => {
    for (const [from, to] of [
      ['HELD', 'PENDING_PAYMENT'],
      ['PENDING_PAYMENT', 'CONFIRMED'],
      ['PENDING_PAYMENT', 'AWAITING_OWNER'],
      ['AWAITING_OWNER', 'CONFIRMED'],
      ['AWAITING_OWNER', 'REFUNDED'],
      ['CONFIRMED', 'COMPLETED'],
      ['CONFIRMED', 'CANCELLED'],
      ['CANCELLED', 'REFUNDED'],
      ['HELD', 'EXPIRED'],
      ['PENDING_PAYMENT', 'EXPIRED'],
    ] as const) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it('throws on every transition not in the table', () => {
    let illegal = 0;
    for (const from of ALL) {
      for (const to of ALL) {
        if (TRANSITIONS[from].includes(to)) continue;
        illegal++;
        expect(() => assertTransition(from, to), `${from} → ${to}`).toThrow(IllegalTransitionError);
      }
    }
    expect(illegal).toBeGreaterThan(50);
  });

  it('treats completed, expired and refunded as terminal', () => {
    for (const s of ['COMPLETED', 'EXPIRED', 'REFUNDED'] as const)
      expect(TRANSITIONS[s]).toEqual([]);
  });

  it('never skips payment: a hold cannot be confirmed directly', () => {
    expect(canTransition('HELD', 'CONFIRMED')).toBe(false);
    expect(canTransition('EXPIRED', 'HELD')).toBe(false);
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
  });
});
