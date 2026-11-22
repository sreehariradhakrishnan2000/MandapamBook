import { randomUUID } from 'node:crypto';
import { hmacSha256, randomToken, safeEqual } from '../../../lib/crypto.js';
import {
  type CreateOrderInput,
  type NormalizedWebhookEvent,
  type PaymentProvider,
  type ProviderOrder,
  type ProviderPaymentStatus,
  type ProviderRefund,
  type RefundInput,
  type VerificationResult,
  type VerifyPaymentInput,
  type WebhookInput,
  WebhookSignatureError,
} from '../provider.js';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';
export const MOCK_TIMESTAMP_HEADER = 'x-mock-timestamp';
/** Webhooks older (or newer) than this are rejected as replays. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type MockOutcome = 'success' | 'failure' | 'pending' | 'delayed';

interface MockOrder {
  providerOrderId: string;
  amountPaise: number;
  status: ProviderPaymentStatus;
  providerPaymentId?: string;
}

export interface MockWebhook {
  rawBody: Buffer;
  headers: Record<string, string>;
}

/**
 * A fake gateway that behaves like a real one where it matters: checkout signatures are
 * HMAC(order|payment) with a key secret, and webhooks are HMAC-signed over the raw body
 * with a separate webhook secret and a timestamp, so the real verification path runs.
 *
 * Order state lives in this process, which is fine for a test gateway.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  readonly testMode = true;
  private readonly orders = new Map<string, MockOrder>();

  constructor(
    private readonly keySecret: Buffer,
    private readonly webhookSecret: Buffer,
    /** Path of our own mock checkout page; the order id is appended. */
    private readonly checkoutPath = '/api/v1/payments/mock/checkout',
  ) {}

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const providerOrderId = `mock_order_${randomToken(12)}`;
    this.orders.set(providerOrderId, {
      providerOrderId,
      amountPaise: input.amountPaise,
      status: 'CREATED',
    });
    return {
      providerOrderId,
      checkout: { kind: 'redirect', url: `${this.checkoutPath}/${providerOrderId}` },
      raw: {
        id: providerOrderId,
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.bookingRef,
      },
    };
  }

  /** Signature the gateway gives the browser after checkout (Razorpay-style). */
  checkoutSignature(providerOrderId: string, providerPaymentId: string): string {
    return hmacSha256(this.keySecret, `${providerOrderId}|${providerPaymentId}`).toString('hex');
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerificationResult> {
    if (
      !/^mock_order_[A-Za-z0-9_-]+$/.test(input.providerOrderId) ||
      !/^mock_pay_[A-Za-z0-9_-]+$/.test(input.providerPaymentId)
    ) {
      return { valid: false, reason: 'malformed' };
    }
    const expected = this.checkoutSignature(input.providerOrderId, input.providerPaymentId);
    return safeEqual(expected, input.signature)
      ? { valid: true, providerPaymentId: input.providerPaymentId }
      : { valid: false, reason: 'bad_signature' };
  }

  /** Builds a webhook exactly as the gateway would send it. */
  signWebhook(
    event: Record<string, unknown>,
    timestamp = Math.floor(Date.now() / 1000),
  ): MockWebhook {
    const rawBody = Buffer.from(JSON.stringify(event));
    const signature = hmacSha256(
      this.webhookSecret,
      `${timestamp}.${rawBody.toString('utf8')}`,
    ).toString('hex');
    return {
      rawBody,
      headers: {
        [MOCK_SIGNATURE_HEADER]: signature,
        [MOCK_TIMESTAMP_HEADER]: String(timestamp),
        'content-type': 'application/json',
      },
    };
  }

  async handleWebhook(input: WebhookInput): Promise<NormalizedWebhookEvent> {
    const signature = input.headers[MOCK_SIGNATURE_HEADER];
    const timestamp = Number(input.headers[MOCK_TIMESTAMP_HEADER]);
    if (!signature || !Number.isInteger(timestamp)) throw new WebhookSignatureError('missing');
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS)
      throw new WebhookSignatureError('stale');
    const expected = hmacSha256(
      this.webhookSecret,
      `${timestamp}.${input.rawBody.toString('utf8')}`,
    ).toString('hex');
    if (!safeEqual(expected, signature)) throw new WebhookSignatureError('mismatch');

    let body: {
      id?: unknown;
      event?: unknown;
      orderId?: unknown;
      paymentId?: unknown;
      refundId?: unknown;
      amount?: unknown;
    };
    try {
      body = JSON.parse(input.rawBody.toString('utf8')) as typeof body;
    } catch {
      throw new WebhookSignatureError('malformed');
    }
    if (typeof body.id !== 'string' || typeof body.event !== 'string')
      throw new WebhookSignatureError('malformed');
    const known = [
      'payment.captured',
      'payment.failed',
      'refund.processed',
      'refund.failed',
    ] as const;
    const type = (known as readonly string[]).includes(body.event)
      ? (body.event as (typeof known)[number])
      : 'ignored';
    return {
      eventId: body.id,
      type,
      ...(typeof body.orderId === 'string' ? { providerOrderId: body.orderId } : {}),
      ...(typeof body.paymentId === 'string' ? { providerPaymentId: body.paymentId } : {}),
      ...(typeof body.refundId === 'string' ? { providerRefundId: body.refundId } : {}),
      ...(Number.isSafeInteger(body.amount) ? { amountPaise: body.amount as number } : {}),
      raw: body,
    };
  }

  async refund(input: RefundInput): Promise<ProviderRefund> {
    return {
      providerRefundId: `mock_rfnd_${randomToken(10)}`,
      status: 'PROCESSED',
      raw: { ...input },
    };
  }

  async getStatus({
    providerOrderId,
  }: {
    providerOrderId: string;
  }): Promise<ProviderPaymentStatus> {
    return this.orders.get(providerOrderId)?.status ?? 'UNKNOWN';
  }

  /**
   * What happens when the tester presses a button on the mock checkout page. Returns the
   * browser redirect data and the webhook the gateway would send (if any, and when).
   */
  simulate(
    providerOrderId: string,
    outcome: MockOutcome,
    amountPaise?: number,
  ): {
    redirect: {
      status: 'success' | 'failure' | 'pending';
      providerPaymentId: string;
      signature: string;
    };
    webhook: MockWebhook | null;
    webhookDelayMs: number;
  } {
    const order = this.orders.get(providerOrderId);
    const providerPaymentId = `mock_pay_${randomToken(12)}`;
    const amount = amountPaise ?? order?.amountPaise ?? 0;
    if (order) {
      order.providerPaymentId = providerPaymentId;
      order.status =
        outcome === 'failure' ? 'FAILED' : outcome === 'pending' ? 'PENDING' : 'CAPTURED';
    }
    const signature = this.checkoutSignature(providerOrderId, providerPaymentId);
    if (outcome === 'pending') {
      return {
        redirect: { status: 'pending', providerPaymentId, signature },
        webhook: null,
        webhookDelayMs: 0,
      };
    }
    const webhook = this.signWebhook({
      id: `evt_${randomUUID()}`,
      event: outcome === 'failure' ? 'payment.failed' : 'payment.captured',
      orderId: providerOrderId,
      paymentId: providerPaymentId,
      amount,
    });
    return {
      redirect: {
        status: outcome === 'failure' ? 'failure' : 'success',
        providerPaymentId,
        signature,
      },
      webhook,
      webhookDelayMs: outcome === 'delayed' ? 30_000 : 0,
    };
  }
}
