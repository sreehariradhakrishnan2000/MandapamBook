/**
 * The only payment abstraction business code may depend on. Concrete providers live in
 * ./mock and ./razorpay and are created exclusively by ./factory.ts (enforced by ESLint).
 * All amounts are integer paise in INR.
 */

export type ProviderName = 'mock' | 'razorpay';

export interface CreateOrderInput {
  /** Our payment row id; providers echo it back as a receipt/reference. */
  paymentId: string;
  bookingRef: string;
  amountPaise: number;
  currency: 'INR';
  /** Sent to providers that support idempotent order creation. */
  idempotencyKey: string;
}

export interface ProviderOrder {
  providerOrderId: string;
  /** Data the browser needs to open the provider's checkout (never secrets). */
  checkout: Record<string, string>;
  raw: unknown;
}

export interface VerifyPaymentInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export type VerificationResult =
  | { valid: true; providerPaymentId: string }
  | { valid: false; reason: 'bad_signature' | 'malformed' };

export interface WebhookInput {
  /** The exact bytes received. Signatures are computed over these, never re-serialised JSON. */
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
}

export type NormalizedEventType =
  'payment.captured' | 'payment.failed' | 'refund.processed' | 'refund.failed' | 'ignored';

export interface NormalizedWebhookEvent {
  /** Provider's unique event id, used for replay protection. */
  eventId: string;
  type: NormalizedEventType;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerRefundId?: string;
  amountPaise?: number;
  raw: unknown;
}

export class WebhookSignatureError extends Error {
  override name = 'WebhookSignatureError';
  constructor(readonly reason: 'missing' | 'mismatch' | 'stale' | 'malformed') {
    super(`webhook rejected: ${reason}`);
  }
}

export interface RefundInput {
  providerPaymentId: string;
  amountPaise: number;
  idempotencyKey: string;
  reason: string;
}

export interface ProviderRefund {
  providerRefundId: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  raw: unknown;
}

export type ProviderPaymentStatus = 'CREATED' | 'PENDING' | 'CAPTURED' | 'FAILED' | 'UNKNOWN';

export interface PaymentProvider {
  readonly name: ProviderName;
  /** True for the mock provider and gateway test keys (no real money); drives the TEST MODE banner. */
  readonly testMode: boolean;
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  /** Checks the signature the browser received after checkout. */
  verifyPayment(input: VerifyPaymentInput): Promise<VerificationResult>;
  /** Verifies and normalises a webhook. Throws WebhookSignatureError when it is not authentic. */
  handleWebhook(input: WebhookInput): Promise<NormalizedWebhookEvent>;
  refund(input: RefundInput): Promise<ProviderRefund>;
  /**
   * Current state of a refund the provider already accepted. Used to follow up pending
   * refunds: asking again with refund() would start a second refund.
   */
  getRefund(input: {
    providerPaymentId: string;
    providerRefundId: string;
  }): Promise<ProviderRefund>;
  getStatus(input: { providerOrderId: string }): Promise<ProviderPaymentStatus>;
}
