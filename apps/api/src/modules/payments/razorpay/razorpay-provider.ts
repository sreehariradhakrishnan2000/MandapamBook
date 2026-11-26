import { createHmac } from 'node:crypto';
import { safeEqual } from '../../../lib/crypto.js';
import {
  type CreateOrderInput,
  type NormalizedEventType,
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

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Overridable for tests; defaults to the real API. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** A Razorpay API call that failed. Carries Razorpay's error code, never credentials. */
export class RazorpayApiError extends Error {
  override name = 'RazorpayApiError';
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    description: string | undefined,
    readonly path: string,
  ) {
    super(`Razorpay ${path} failed with ${status}${code ? ` ${code}` : ''}: ${description ?? ''}`);
  }
}

export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';
export const RAZORPAY_EVENT_ID_HEADER = 'x-razorpay-event-id';

/** Razorpay limits receipts to 40 characters. */
const receipt = (value: string) => value.slice(0, 40);

const EVENT_TYPES: Record<string, NormalizedEventType> = {
  'payment.captured': 'payment.captured',
  'payment.failed': 'payment.failed',
  'refund.processed': 'refund.processed',
  'refund.failed': 'refund.failed',
};

const REFUND_STATUS: Record<string, ProviderRefund['status']> = {
  processed: 'PROCESSED',
  pending: 'PENDING',
  failed: 'FAILED',
};

interface RazorpayEntity {
  id?: string;
  order_id?: string;
  payment_id?: string;
  amount?: number;
  status?: string;
}

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    refund?: { entity?: RazorpayEntity };
  };
}

/**
 * Razorpay Payment Gateway (Standard Checkout). Talks to the REST API with `fetch`; no SDK.
 *
 * - Orders are created server side; the browser opens Razorpay's checkout with the order id
 *   and our public key id, then sends the returned ids and signature to /payments/verify.
 * - The checkout signature is HMAC_SHA256(keySecret, "order_id|payment_id") as hex.
 * - Webhooks are signed with HMAC_SHA256(webhookSecret, raw body) as hex, and carry a unique
 *   event id header used for replay protection (Razorpay sends no timestamp).
 * - Payments must be captured automatically: set Account & Settings → Payment capture to
 *   "Automatic" in the Razorpay dashboard. We only treat `captured` as paid.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  readonly testMode: boolean;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: RazorpayConfig) {
    // Razorpay's test keys never move real money; the app shows its TEST MODE banner.
    this.testMode = config.keyId.startsWith('rzp_test_');
    this.baseUrl = config.baseUrl ?? 'https://api.razorpay.com';
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  /** Public checkout data only; the key secret never leaves the server. */
  get publicKeyId(): string {
    return this.config.keyId;
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const order = await this.call<{ id: string; amount: number; currency: string }>(
      'POST',
      '/v1/orders',
      {
        amount: input.amountPaise,
        currency: input.currency,
        receipt: receipt(input.bookingRef),
        notes: { paymentId: input.paymentId, bookingRef: input.bookingRef },
      },
    );
    return {
      providerOrderId: order.id,
      checkout: {
        kind: 'razorpay',
        keyId: this.config.keyId,
        orderId: order.id,
        amount: String(order.amount),
        currency: order.currency,
      },
      raw: order,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerificationResult> {
    if (
      !input.providerOrderId ||
      !input.providerPaymentId ||
      !/^[0-9a-f]{64}$/i.test(input.signature)
    ) {
      return { valid: false, reason: 'malformed' };
    }
    const expected = createHmac('sha256', this.config.keySecret)
      .update(`${input.providerOrderId}|${input.providerPaymentId}`)
      .digest('hex');
    return safeEqual(expected, input.signature.toLowerCase())
      ? { valid: true, providerPaymentId: input.providerPaymentId }
      : { valid: false, reason: 'bad_signature' };
  }

  async handleWebhook(input: WebhookInput): Promise<NormalizedWebhookEvent> {
    const signature = input.headers[RAZORPAY_SIGNATURE_HEADER];
    const eventId = input.headers[RAZORPAY_EVENT_ID_HEADER];
    if (!signature || !eventId) throw new WebhookSignatureError('missing');
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(input.rawBody)
      .digest('hex');
    if (!safeEqual(expected, signature.toLowerCase())) throw new WebhookSignatureError('mismatch');

    let body: RazorpayWebhookBody;
    try {
      body = JSON.parse(input.rawBody.toString('utf8')) as RazorpayWebhookBody;
    } catch {
      throw new WebhookSignatureError('malformed');
    }
    const type = EVENT_TYPES[body.event ?? ''] ?? 'ignored';
    const payment = body.payload?.payment?.entity;
    const refund = body.payload?.refund?.entity;
    const isRefund = type === 'refund.processed' || type === 'refund.failed';
    const amount = isRefund ? refund?.amount : payment?.amount;
    const paymentId = payment?.id ?? refund?.payment_id;
    return {
      eventId,
      type,
      ...(payment?.order_id ? { providerOrderId: payment.order_id } : {}),
      ...(paymentId ? { providerPaymentId: paymentId } : {}),
      ...(refund?.id ? { providerRefundId: refund.id } : {}),
      ...(typeof amount === 'number' ? { amountPaise: amount } : {}),
      raw: body,
    };
  }

  async refund(input: RefundInput): Promise<ProviderRefund> {
    const refund = await this.call<{ id: string; status: string }>(
      'POST',
      `/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refund`,
      {
        amount: input.amountPaise,
        speed: 'normal',
        receipt: receipt(input.idempotencyKey),
        notes: { reason: input.reason.slice(0, 250) },
      },
    );
    return {
      providerRefundId: refund.id,
      status: REFUND_STATUS[refund.status] ?? 'PENDING',
      raw: refund,
    };
  }

  async getRefund(input: {
    providerPaymentId: string;
    providerRefundId: string;
  }): Promise<ProviderRefund> {
    const refund = await this.call<{ id: string; status: string }>(
      'GET',
      `/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refunds/${encodeURIComponent(input.providerRefundId)}`,
    );
    return {
      providerRefundId: refund.id,
      status: REFUND_STATUS[refund.status] ?? 'PENDING',
      raw: refund,
    };
  }

  async getStatus(input: { providerOrderId: string }): Promise<ProviderPaymentStatus> {
    let payments: { items?: { status?: string }[] };
    try {
      payments = await this.call(
        'GET',
        `/v1/orders/${encodeURIComponent(input.providerOrderId)}/payments`,
      );
    } catch (err) {
      if (err instanceof RazorpayApiError && (err.status === 400 || err.status === 404))
        return 'UNKNOWN';
      throw err;
    }
    const statuses = (payments.items ?? []).map((p) => p.status);
    if (statuses.some((s) => s === 'captured' || s === 'refunded')) return 'CAPTURED';
    if (statuses.some((s) => s === 'authorized' || s === 'created')) return 'PENDING';
    if (statuses.length > 0 && statuses.every((s) => s === 'failed')) return 'FAILED';
    return 'CREATED';
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64');
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      const error = (json as { error?: { code?: string; description?: string } }).error;
      throw new RazorpayApiError(res.status, error?.code, error?.description, path);
    }
    return json as T;
  }
}
