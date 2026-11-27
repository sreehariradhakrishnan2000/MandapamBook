import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPaymentProvider } from '../../src/modules/payments/factory.js';
import {
  MockPaymentProvider,
  WEBHOOK_TOLERANCE_SECONDS,
} from '../../src/modules/payments/mock/mock-provider.js';
import { WebhookSignatureError } from '../../src/modules/payments/provider.js';
import { RazorpayProvider } from '../../src/modules/payments/razorpay/razorpay-provider.js';

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
    // Test keys move no real money, so the TEST MODE banner shows.
    expect(rzp).toMatchObject({ name: 'razorpay', testMode: true });
    const live = createPaymentProvider({
      PAYMENT_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_live_abc',
      RAZORPAY_KEY_SECRET: 'test-only-secret-1234',
      RAZORPAY_WEBHOOK_SECRET: 'test-only-secret-5678',
    });
    expect(live.testMode).toBe(false);
  });
});

describe('RazorpayProvider', () => {
  // Fresh random values each run: nothing secret-looking is committed.
  const KEY_ID = 'rzp_test_FAKEKEYFORTESTS';
  const KEY_SECRET = randomBytes(18).toString('hex');
  const WEBHOOK_SECRET = randomBytes(18).toString('hex');
  const hmac = (key: string, data: string | Buffer) =>
    createHmac('sha256', key).update(data).digest('hex');

  /** A fake Razorpay API: records requests and replays canned responses. */
  function fakeApi(responses: Record<string, { status?: number; body: unknown }>) {
    const calls: { method: string; url: string; auth: string | null; body: unknown }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        url: u,
        auth: new Headers(init?.headers).get('authorization'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const key = `${method} ${new URL(u).pathname}`;
      const r = responses[key];
      if (!r) return new Response('{"error":{"code":"BAD_REQUEST_ERROR"}}', { status: 404 });
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    });
    const provider = new RazorpayProvider({
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      fetch: fetchFn as unknown as typeof fetch,
    });
    return { provider, calls };
  }

  it('creates an order with Basic auth and returns checkout data without the secret', async () => {
    const { provider, calls } = fakeApi({
      'POST /v1/orders': {
        body: { id: 'order_IluGWxBm9U8zJ8', amount: 3_589_900, currency: 'INR', status: 'created' },
      },
    });
    const order = await provider.createOrder({
      paymentId: 'pay-row-1',
      bookingRef: 'MB-ABC234',
      amountPaise: 3_589_900,
      currency: 'INR',
      idempotencyKey: 'k',
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.razorpay.com/v1/orders',
      auth: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`,
      body: {
        amount: 3_589_900,
        currency: 'INR',
        receipt: 'MB-ABC234',
        notes: { paymentId: 'pay-row-1', bookingRef: 'MB-ABC234' },
      },
    });
    expect(order.providerOrderId).toBe('order_IluGWxBm9U8zJ8');
    expect(order.checkout).toEqual({
      kind: 'razorpay',
      keyId: KEY_ID,
      orderId: 'order_IluGWxBm9U8zJ8',
      amount: '3589900',
      currency: 'INR',
    });
    expect(JSON.stringify(order.checkout)).not.toContain(KEY_SECRET);
  });

  it('surfaces Razorpay API errors with their code', async () => {
    const { provider } = fakeApi({
      'POST /v1/orders': {
        status: 401,
        body: { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } },
      },
    });
    await expect(
      provider.createOrder({
        paymentId: 'p',
        bookingRef: 'r',
        amountPaise: 100,
        currency: 'INR',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'RazorpayApiError', status: 401, code: 'BAD_REQUEST_ERROR' });
  });

  it('verifies the checkout signature and rejects tampering', async () => {
    const { provider } = fakeApi({});
    const signature = hmac(KEY_SECRET, 'order_A|pay_B');
    expect(
      await provider.verifyPayment({
        providerOrderId: 'order_A',
        providerPaymentId: 'pay_B',
        signature,
      }),
    ).toEqual({ valid: true, providerPaymentId: 'pay_B' });
    expect(
      await provider.verifyPayment({
        providerOrderId: 'order_A',
        providerPaymentId: 'pay_OTHER',
        signature,
      }),
    ).toEqual({ valid: false, reason: 'bad_signature' });
    expect(
      await provider.verifyPayment({
        providerOrderId: 'order_A',
        providerPaymentId: 'pay_B',
        signature: 'not-hex',
      }),
    ).toEqual({ valid: false, reason: 'malformed' });
  });

  it('accepts signed webhooks and normalises payment and refund events', async () => {
    const { provider } = fakeApi({});
    const captured = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: { entity: { id: 'pay_B', order_id: 'order_A', amount: 3_589_900 } },
        },
      }),
    );
    expect(
      await provider.handleWebhook({
        rawBody: captured,
        headers: {
          'x-razorpay-signature': hmac(WEBHOOK_SECRET, captured),
          'x-razorpay-event-id': 'evt_1',
        },
      }),
    ).toMatchObject({
      eventId: 'evt_1',
      type: 'payment.captured',
      providerOrderId: 'order_A',
      providerPaymentId: 'pay_B',
      amountPaise: 3_589_900,
    });

    const refund = Buffer.from(
      JSON.stringify({
        event: 'refund.processed',
        payload: {
          refund: { entity: { id: 'rfnd_C', payment_id: 'pay_B', amount: 50_000 } },
          payment: { entity: { id: 'pay_B', order_id: 'order_A', amount: 3_589_900 } },
        },
      }),
    );
    expect(
      await provider.handleWebhook({
        rawBody: refund,
        headers: {
          'x-razorpay-signature': hmac(WEBHOOK_SECRET, refund),
          'x-razorpay-event-id': 'evt_2',
        },
      }),
    ).toMatchObject({ type: 'refund.processed', providerRefundId: 'rfnd_C', amountPaise: 50_000 });

    const other = Buffer.from('{"event":"order.paid","payload":{}}');
    expect(
      (
        await provider.handleWebhook({
          rawBody: other,
          headers: {
            'x-razorpay-signature': hmac(WEBHOOK_SECRET, other),
            'x-razorpay-event-id': 'evt_3',
          },
        })
      ).type,
    ).toBe('ignored');
  });

  it('rejects webhooks that are unsigned, tampered with, or signed with another secret', async () => {
    const { provider } = fakeApi({});
    const body = Buffer.from('{"event":"payment.captured","payload":{}}');
    const signed = {
      'x-razorpay-signature': hmac(WEBHOOK_SECRET, body),
      'x-razorpay-event-id': 'e',
    };
    await expect(provider.handleWebhook({ rawBody: body, headers: {} })).rejects.toMatchObject({
      reason: 'missing',
    });
    await expect(
      provider.handleWebhook({ rawBody: Buffer.from(`${body} `), headers: signed }),
    ).rejects.toMatchObject({ reason: 'mismatch' });
    await expect(
      provider.handleWebhook({
        rawBody: body,
        headers: { ...signed, 'x-razorpay-signature': hmac('another-secret', body) },
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
    const garbage = Buffer.from('not json');
    await expect(
      provider.handleWebhook({
        rawBody: garbage,
        headers: {
          'x-razorpay-signature': hmac(WEBHOOK_SECRET, garbage),
          'x-razorpay-event-id': 'e',
        },
      }),
    ).rejects.toMatchObject({ reason: 'malformed' });
  });

  it('refunds a payment and maps the refund status', async () => {
    const { provider, calls } = fakeApi({
      'POST /v1/payments/pay_B/refund': { body: { id: 'rfnd_C', status: 'processed' } },
    });
    expect(
      await provider.refund({
        providerPaymentId: 'pay_B',
        amountPaise: 50_000,
        idempotencyKey: 'refund-key-that-is-definitely-longer-than-forty-characters',
        reason: 'Owner declined',
      }),
    ).toMatchObject({ providerRefundId: 'rfnd_C', status: 'PROCESSED' });
    expect(calls[0]?.body).toMatchObject({ amount: 50_000, speed: 'optimum' });
    expect((calls[0]?.body as { receipt: string }).receipt).toHaveLength(40);
  });

  it('reports order status from its payments', async () => {
    const status = (items: { status: string }[]) =>
      fakeApi({ 'GET /v1/orders/order_A/payments': { body: { items } } }).provider.getStatus({
        providerOrderId: 'order_A',
      });
    expect(await status([])).toBe('CREATED');
    expect(await status([{ status: 'failed' }, { status: 'captured' }])).toBe('CAPTURED');
    expect(await status([{ status: 'authorized' }])).toBe('PENDING');
    expect(await status([{ status: 'failed' }, { status: 'failed' }])).toBe('FAILED');
    expect(await fakeApi({}).provider.getStatus({ providerOrderId: 'order_missing' })).toBe(
      'UNKNOWN',
    );
  });
});
