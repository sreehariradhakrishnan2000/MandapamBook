import type {
  CreateOrderInput,
  NormalizedWebhookEvent,
  PaymentProvider,
  ProviderOrder,
  ProviderPaymentStatus,
  ProviderRefund,
  RefundInput,
  VerificationResult,
  VerifyPaymentInput,
  WebhookInput,
} from '../provider.js';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export class NotImplementedError extends Error {
  override name = 'NotImplementedError';
}

/**
 * Razorpay adapter: same interface as the mock, so switching is PAYMENT_PROVIDER=razorpay
 * plus credentials. Each method documents exactly what to implement; see
 * docs/payments-migration.md for the full checklist. Every method throws until then.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  readonly testMode = false;

  constructor(private readonly config: RazorpayConfig) {}

  /**
   * TODO: POST https://api.razorpay.com/v1/orders with Basic auth (keyId:keySecret) and
   * { amount: amountPaise, currency: 'INR', receipt: bookingRef, notes: { paymentId } }.
   * Return { providerOrderId: order.id, checkout: { kind: 'razorpay', keyId, orderId } }.
   * Razorpay has no idempotency header for orders: our unique idempotency_key prevents
   * creating two orders for one attempt.
   */
  async createOrder(_input: CreateOrderInput): Promise<ProviderOrder> {
    throw new NotImplementedError('RazorpayProvider.createOrder is not implemented yet');
  }

  /**
   * TODO: expected = HMAC_SHA256(keySecret, `${razorpay_order_id}|${razorpay_payment_id}`) as hex;
   * compare with razorpay_signature using a constant-time comparison.
   */
  async verifyPayment(_input: VerifyPaymentInput): Promise<VerificationResult> {
    throw new NotImplementedError('RazorpayProvider.verifyPayment is not implemented yet');
  }

  /**
   * TODO: verify header X-Razorpay-Signature = HMAC_SHA256(webhookSecret, rawBody) as hex
   * (constant time). Use header X-Razorpay-Event-Id as eventId (replay protection).
   * Map: payment.captured → payment.captured; payment.failed → payment.failed;
   * refund.processed → refund.processed; refund.failed → refund.failed; else 'ignored'.
   * Amount: payload.payment.entity.amount (paise). Order: payload.payment.entity.order_id.
   * Razorpay sends no timestamp header; rely on event-id uniqueness for replays.
   */
  async handleWebhook(_input: WebhookInput): Promise<NormalizedWebhookEvent> {
    throw new NotImplementedError('RazorpayProvider.handleWebhook is not implemented yet');
  }

  /**
   * TODO: POST /v1/payments/{providerPaymentId}/refund with { amount, speed: 'normal',
   * receipt: idempotencyKey, notes: { reason } }. Map status 'processed' → PROCESSED,
   * 'pending' → PENDING, 'failed' → FAILED.
   */
  async refund(_input: RefundInput): Promise<ProviderRefund> {
    throw new NotImplementedError('RazorpayProvider.refund is not implemented yet');
  }

  /**
   * TODO: GET /v1/orders/{providerOrderId}/payments; CAPTURED if any payment is captured,
   * FAILED if all failed, PENDING if authorized, CREATED if none.
   */
  async getStatus(_input: { providerOrderId: string }): Promise<ProviderPaymentStatus> {
    throw new NotImplementedError('RazorpayProvider.getStatus is not implemented yet');
  }

  /** Public checkout data only; the key secret never leaves the server. */
  get publicKeyId(): string {
    return this.config.keyId;
  }
}
