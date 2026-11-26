import { describe, expect, it } from 'vitest';
import { withoutPersonalData } from '../../src/modules/payments/redact.js';

describe('stored webhook payloads', () => {
  it('drops the customer contact, UPI and card details, keeping what debugging needs', () => {
    // The shape Razorpay sends for payment.captured (values made up).
    const raw = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_X',
            order_id: 'order_Y',
            amount: 875900,
            currency: 'INR',
            status: 'captured',
            method: 'card',
            email: 'customer@example.test',
            contact: '+919800000000',
            vpa: 'someone@upi',
            card: { id: 'card_Z', last4: '5449', network: 'MasterCard', name: 'A Person' },
            card_id: 'card_Z',
            token_id: 'token_Q',
            acquirer_data: { auth_code: '568703' },
            notes: { paymentId: 'p1', bookingRef: 'MB-PGN6U5' },
            error_code: null,
          },
        },
      },
      contains: ['payment'],
    };
    const stored = withoutPersonalData(raw);
    const text = JSON.stringify(stored);
    for (const leaked of [
      'customer@example.test',
      '+919800000000',
      'someone@upi',
      '5449',
      'A Person',
      'token_Q',
      '568703',
    ])
      expect(text).not.toContain(leaked);
    expect(stored).toMatchObject({
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_X',
            order_id: 'order_Y',
            amount: 875900,
            status: 'captured',
            method: 'card',
            notes: { bookingRef: 'MB-PGN6U5' },
            error_code: null,
          },
        },
      },
    });
    // The original is not modified.
    expect(raw.payload.payment.entity.email).toBe('customer@example.test');
  });
});
