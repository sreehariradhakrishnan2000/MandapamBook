import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPaymentProvider } from '../../src/modules/payments/factory.js';
import {
  MockPaymentProvider,
  WEBHOOK_TOLERANCE_SECONDS,
} from '../../src/modules/payments/mock/mock-provider.js';
import { WebhookSignatureError } from '../../src/modules/payments/provider.js';
import { NotImplementedError } from '../../src/modules/payments/razorpay/razorpay-provider.js';

const mock = () => new MockPaymentProvider(randomBytes(32), randomBytes(32));

describe('MockPaymentProvider', () => {
  it('creates orders with a redirect checkout and reports status', async () => {
    const p = mock();
    const order = await p.createOrder({
      paymentId: 'p1',
      bookingRef: 'MB-ABC234',
      amountPaise: 3_589_900,
      currency: 'INR',
      idempotencyKey: 'k',
    });
    expect(order.providerOrderId).toMatch(/^mock_order_/);
    expect(order.checkout).toEqual({
      kind: 'redirect',
      url: `/api/v1/payments/mock/checkout/${order.providerOrderId}`,
    });
    expect(await p.getStatus({ providerOrderId: order.providerOrderId })).toBe('CREATED');
    expect(await p.getStatus({ providerOrderId: 'mock_order_nope' })).toBe('UNKNOWN');
  });

  it('verifies checkout signatures and rejects tampering', async () => {
    const p = mock();
    const { providerOrderId } = await p.createOrder({
      paymentId: 'p',
      bookingRef: 'r',
      amountPaise: 100,
      currency: 'INR',
      idempotencyKey: 'k',
    });
    const { redirect } = p.simulate(providerOrderId, 'success');
    expect(
      await p.verifyPayment({
        providerOrderId,
        providerPaymentId: redirect.providerPaymentId,
        signature: redirect.signature,
      }),
    ).toEqual({
      valid: true,
      providerPaymentId: redirect.providerPaymentId,
    });
    expect(
      (
        await p.verifyPayment({
          providerOrderId,
          providerPaymentId: redirect.providerPaymentId,
          signature: 'f'.repeat(64),
        })
      ).valid,
    ).toBe(false);
    expect(
      (
        await p.verifyPayment({
          providerOrderId: 'other',
          providerPaymentId: redirect.providerPaymentId,
          signature: redirect.signature,
        })
      ).valid,
    ).toBe(false);
    // A different provider instance (different secret) cannot forge signatures.
    expect(
      (
        await mock().verifyPayment({
          providerOrderId,
          providerPaymentId: redirect.providerPaymentId,
          signature: redirect.signature,
        })
      ).valid,
    ).toBe(false);
  });

  it('accepts its own signed webhooks and normalises them', async () => {
    const p = mock();
    const hook = p.signWebhook({
      id: 'evt_1',
      event: 'payment.captured',
      orderId: 'mock_order_x',
      paymentId: 'mock_pay_y',
      amount: 500,
    });
    const event = await p.handleWebhook({ rawBody: hook.rawBody, headers: hook.headers });
    expect(event).toMatchObject({
      eventId: 'evt_1',
      type: 'payment.captured',
      providerOrderId: 'mock_order_x',
      providerPaymentId: 'mock_pay_y',
      amountPaise: 500,
    });
  });

  it('rejects webhooks with a wrong signature, a modified body, no headers, or an old timestamp', async () => {
    const p = mock();
    const hook = p.signWebhook({ id: 'evt_1', event: 'payment.captured', amount: 500 });
    const tampered = Buffer.from(hook.rawBody.toString().replace('500', '1'));
    await expect(
      p.handleWebhook({ rawBody: tampered, headers: hook.headers }),
    ).rejects.toMatchObject({ reason: 'mismatch' });
    await expect(p.handleWebhook({ rawBody: hook.rawBody, headers: {} })).rejects.toMatchObject({
      reason: 'missing',
    });
    await expect(
      mock().handleWebhook({ rawBody: hook.rawBody, headers: hook.headers }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);

    const old = p.signWebhook(
      { id: 'evt_2', event: 'payment.captured' },
      Math.floor(Date.now() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 5,
    );
    await expect(
      p.handleWebhook({ rawBody: old.rawBody, headers: old.headers }),
    ).rejects.toMatchObject({ reason: 'stale' });
  });

  it('ignores unknown event types and rejects malformed bodies', async () => {
    const p = mock();
    const other = p.signWebhook({ id: 'evt_3', event: 'order.paid' });
    expect((await p.handleWebhook({ rawBody: other.rawBody, headers: other.headers })).type).toBe(
      'ignored',
    );
    const noId = p.signWebhook({ event: 'payment.captured' });
    await expect(
      p.handleWebhook({ rawBody: noId.rawBody, headers: noId.headers }),
    ).rejects.toMatchObject({ reason: 'malformed' });
  });

  it('simulates success, failure, pending and delayed outcomes', async () => {
    const p = mock();
    const { providerOrderId } = await p.createOrder({
      paymentId: 'p',
      bookingRef: 'r',
      amountPaise: 700,
      currency: 'INR',
      idempotencyKey: 'k',
    });
    expect(p.simulate(providerOrderId, 'pending').webhook).toBeNull();
    const failed = p.simulate(providerOrderId, 'failure');
    expect(JSON.parse(failed.webhook!.rawBody.toString()).event).toBe('payment.failed');
    const delayed = p.simulate(providerOrderId, 'delayed');
    expect(delayed.webhookDelayMs).toBe(30_000);
    expect(JSON.parse(delayed.webhook!.rawBody.toString())).toMatchObject({
      event: 'payment.captured',
      amount: 700,
    });
    expect(
      (
        await p.refund({
          providerPaymentId: 'mock_pay_1',
          amountPaise: 1,
          idempotencyKey: 'r',
          reason: 'x',
        })
      ).status,
    ).toBe('PROCESSED');
  });
});

describe('payment provider factory', () => {
  it('builds the configured provider and fails fast without credentials', () => {
    const secrets = {
      MOCK_PAYMENT_KEY_SECRET: randomBytes(32),
      MOCK_PAYMENT_WEBHOOK_SECRET: randomBytes(32),
    };
    expect(createPaymentProvider({ PAYMENT_PROVIDER: 'mock', ...secrets }).name).toBe('mock');
    expect(() => createPaymentProvider({ PAYMENT_PROVIDER: 'mock' })).toThrow();
    expect(() => createPaymentProvider({ PAYMENT_PROVIDER: 'razorpay' })).toThrow(/Razorpay/);
    const rzp = createPaymentProvider({
      PAYMENT_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'test-only-secret-1234',
      RAZORPAY_WEBHOOK_SECRET: 'test-only-secret-5678',
    });
    expect(rzp).toMatchObject({ name: 'razorpay', testMode: false });
  });

  it('keeps every Razorpay method as an explicit, documented stub', async () => {
    const rzp = createPaymentProvider({
      PAYMENT_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'test-only-secret-1234',
      RAZORPAY_WEBHOOK_SECRET: 'test-only-secret-5678',
    });
    const calls = [
      () =>
        rzp.createOrder({
          paymentId: 'p',
          bookingRef: 'r',
          amountPaise: 1,
          currency: 'INR',
          idempotencyKey: 'k',
        }),
      () => rzp.verifyPayment({ providerOrderId: 'o', providerPaymentId: 'p', signature: 's' }),
      () => rzp.handleWebhook({ rawBody: Buffer.from('{}'), headers: {} }),
      () =>
        rzp.refund({ providerPaymentId: 'p', amountPaise: 1, idempotencyKey: 'k', reason: 'r' }),
      () => rzp.getStatus({ providerOrderId: 'o' }),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(NotImplementedError);
    vi.restoreAllMocks();
  });
});
