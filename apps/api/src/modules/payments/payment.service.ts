import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import { auditoriums, bookings, payments, refunds, webhookEvents } from '../../db/schema/index.js';
import { HttpError, errors } from '../../http/errors.js';
import type { AuditContext, AuditService } from '../audit/audit.service.js';
import { type BookingStatus, StaleBookingError, transition } from '../bookings/state-machine.js';
import type { SettingsService } from '../settings/settings.service.js';
import {
  type NormalizedWebhookEvent,
  type PaymentProvider,
  WebhookSignatureError,
} from './provider.js';
import { withoutPersonalData } from './redact.js';
import { TERMS_VERSION } from '@mandapambook/shared';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type PaymentRow = typeof payments.$inferSelect;

const SYSTEM: AuditContext = { ip: null, userAgent: 'system', correlationId: null };
const OPEN: PaymentRow['status'][] = ['CREATED', 'PENDING'];
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export interface OrderView {
  paymentId: string;
  provider: string;
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  checkout: Record<string, string>;
  testMode: boolean;
}

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored';

/**
 * Payments orchestration. Depends only on the PaymentProvider interface.
 *
 * Invariants:
 * - one open order per booking; repeat requests return it (idempotent)
 * - a capture is applied once, however many times the browser and webhooks report it
 * - each webhook event id is processed at most once (replay protection)
 * - money moves only through refunds rows with unique idempotency keys
 */
export class PaymentService {
  constructor(
    private readonly db: Db,
    readonly provider: PaymentProvider,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  // ------------------------------------------------------------ orders

  async createOrder(
    customerId: string,
    bookingId: string,
    clientKey: string | undefined,
    ctx: AuditContext,
  ): Promise<OrderView> {
    if (clientKey !== undefined && !IDEMPOTENCY_KEY.test(clientKey)) {
      throw errors.badRequest(
        'BAD_IDEMPOTENCY_KEY',
        'Idempotency-Key must be 8-64 letters, digits, - or _',
      );
    }
    const idempotencyKey = `${customerId}:${clientKey ?? `booking:${bookingId}:${randomUUID()}`}`;

    const reserved = await this.db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.customerId, customerId)))
        .for('update');
      if (!booking) throw errors.notFound('Booking not found');

      const [sameKey] = await tx
        .select()
        .from(payments)
        .where(eq(payments.idempotencyKey, idempotencyKey));
      if (sameKey) {
        if (sameKey.bookingId !== booking.id)
          throw errors.conflict(
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was used for a different booking',
          );
        return { payment: sameKey, existing: true };
      }
      if (booking.status !== 'HELD' && booking.status !== 'PENDING_PAYMENT') {
        throw errors.conflict('NOT_PAYABLE', 'This booking can no longer be paid');
      }
      if (!booking.holdExpiresAt || booking.holdExpiresAt.getTime() <= Date.now()) {
        throw errors.conflict('HOLD_EXPIRED', 'Your hold has expired. Hold the date again to pay.');
      }
      const [open] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.bookingId, booking.id), inArray(payments.status, OPEN)));
      if (open && !open.providerOrderId.startsWith('pending:'))
        return { payment: open, existing: true };

      const paymentId = randomUUID();
      const [payment] = await tx
        .insert(payments)
        .values({
          id: paymentId,
          bookingId: booking.id,
          provider: this.provider.name,
          providerOrderId: `pending:${paymentId}`,
          status: 'CREATED',
          amountPaise: booking.advancePaise,
          idempotencyKey,
        })
        .returning();
      if (!payment) throw new Error('payment insert returned nothing');
      // Evidence for disputes: who agreed, to which terms version, and the exact refund
      // tiers this booking carries (the snapshot taken when the date was held).
      await this.audit.record(
        {
          action: 'terms.accepted',
          entityType: 'booking',
          entityId: booking.id,
          actorId: customerId,
          after: {
            context: 'payment',
            termsVersion: TERMS_VERSION,
            cancellationTiers: booking.priceSnapshot.cancellationTiers,
            platformFeePaise: booking.platformFeePaise,
            advancePaise: booking.advancePaise,
          },
        },
        ctx,
        tx,
      );
      if (booking.status === 'HELD') {
        await transition(tx, {
          bookingId: booking.id,
          from: 'HELD',
          to: 'PENDING_PAYMENT',
          version: booking.version,
          actorId: customerId,
          reason: 'payment_started',
        });
      }
      return { payment, existing: false, bookingRef: booking.refCode };
    });

    let payment = reserved.payment;
    let checkout: Record<string, string>;
    if (!reserved.existing || payment.providerOrderId.startsWith('pending:')) {
      try {
        const order = await this.provider.createOrder({
          paymentId: payment.id,
          bookingRef:
            'bookingRef' in reserved && reserved.bookingRef
              ? reserved.bookingRef
              : payment.bookingId,
          amountPaise: payment.amountPaise,
          currency: 'INR',
          idempotencyKey,
        });
        const [updated] = await this.db
          .update(payments)
          .set({
            providerOrderId: order.providerOrderId,
            rawPayload: { order: order.raw, checkout: order.checkout },
          })
          .where(eq(payments.id, payment.id))
          .returning();
        payment = updated ?? payment;
        checkout = order.checkout;
      } catch (err) {
        await this.db
          .update(payments)
          .set({ status: 'FAILED', rawPayload: { error: String(err) } })
          .where(eq(payments.id, payment.id));
        this.logger.error({ err, paymentId: payment.id }, 'payment provider createOrder failed');
        throw new HttpError(
          502,
          'PAYMENT_PROVIDER_ERROR',
          'We could not start the payment. Try again in a moment.',
        );
      }
      await this.audit.record(
        {
          action: 'payment.order_created',
          entityType: 'payment',
          entityId: payment.id,
          actorId: customerId,
          after: {
            bookingId: payment.bookingId,
            amountPaise: payment.amountPaise,
            provider: payment.provider,
          },
        },
        ctx,
      );
    } else {
      checkout =
        (payment.rawPayload as { checkout?: Record<string, string> } | null)?.checkout ?? {};
    }
    return {
      paymentId: payment.id,
      provider: payment.provider,
      providerOrderId: payment.providerOrderId,
      amountPaise: payment.amountPaise,
      currency: 'INR',
      checkout,
      testMode: this.provider.testMode,
    };
  }

  /** Browser return after checkout: trust only a valid provider signature. */
  async verify(
    customerId: string,
    input: { providerOrderId: string; providerPaymentId: string; signature: string },
    ctx: AuditContext,
  ) {
    const [row] = await this.db
      .select({ payment: payments })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(
        and(
          eq(payments.providerOrderId, input.providerOrderId),
          eq(bookings.customerId, customerId),
        ),
      );
    if (!row) throw errors.notFound('Payment not found');
    const result = await this.provider.verifyPayment(input);
    if (!result.valid) {
      await this.audit.record(
        {
          action: 'payment.verify_failed',
          entityType: 'payment',
          entityId: row.payment.id,
          actorId: customerId,
          success: false,
          after: { reason: result.reason },
        },
        ctx,
      );
      throw errors.badRequest(
        'PAYMENT_NOT_VERIFIED',
        'We could not verify this payment. If money was taken, it will be confirmed or refunded automatically.',
      );
    }
    await this.db.transaction((tx) =>
      this.capture(
        tx,
        row.payment.providerOrderId,
        result.providerPaymentId,
        row.payment.amountPaise,
        'checkout',
      ),
    );
    return this.status(customerId, row.payment.id);
  }

  async status(customerId: string, paymentId: string) {
    const [row] = await this.db
      .select({
        id: payments.id,
        status: payments.status,
        amountPaise: payments.amountPaise,
        refundedPaise: payments.refundedPaise,
        bookingId: bookings.id,
        bookingStatus: bookings.status,
        refCode: bookings.refCode,
      })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(and(eq(payments.id, paymentId), eq(bookings.customerId, customerId)));
    if (!row) throw errors.notFound('Payment not found');
    return row;
  }

  // ------------------------------------------------------------ webhooks

  /**
   * Verifies, deduplicates and applies a webhook. The event row and its effects commit in
   * one transaction: a failure rolls both back so the provider's retry is processed, and a
   * replay of an already-processed event id is acknowledged without doing anything.
   */
  async handleWebhook(
    providerName: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookOutcome> {
    if (providerName !== this.provider.name) throw errors.notFound();
    let event: NormalizedWebhookEvent;
    try {
      event = await this.provider.handleWebhook({ rawBody, headers });
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        await this.audit.record(
          {
            action: 'payment.webhook_rejected',
            entityType: 'webhook',
            success: false,
            after: { provider: providerName, reason: err.reason },
          },
          SYSTEM,
        );
        throw new HttpError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
      }
      throw err;
    }

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(webhookEvents)
        .values({
          provider: providerName,
          eventId: event.eventId,
          eventType: event.type,
          // Kept for debugging, without the customer's personal or card details.
          payload: withoutPersonalData(event.raw) as object,
          processedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (!inserted.length) return 'duplicate';

      switch (event.type) {
        case 'payment.captured':
          if (!event.providerOrderId || !event.providerPaymentId || event.amountPaise === undefined)
            return 'ignored';
          await this.capture(
            tx,
            event.providerOrderId,
            event.providerPaymentId,
            event.amountPaise,
            'webhook',
          );
          return 'processed';
        case 'payment.failed':
          if (!event.providerOrderId) return 'ignored';
          await tx
            .update(payments)
            .set({
              status: 'FAILED',
              providerPaymentId: event.providerPaymentId ?? null,
              rawPayload: { lastEvent: event.raw } as object,
            })
            .where(
              and(
                eq(payments.providerOrderId, event.providerOrderId),
                inArray(payments.status, OPEN),
              ),
            );
          return 'processed';
        case 'refund.processed': {
          if (!event.providerRefundId) return 'processed';
          const [refund] = await tx
            .select({ id: refunds.id })
            .from(refunds)
            .where(eq(refunds.providerRefundId, event.providerRefundId));
          // The full completion (payment totals, booking REFUNDED, email), not just the flag.
          if (refund) await this.completeRefund(tx, refund.id, event.providerRefundId, SYSTEM);
          return 'processed';
        }
        case 'refund.failed':
          if (event.providerRefundId) {
            await tx
              .update(refunds)
              .set({ status: 'FAILED' })
              .where(
                and(
                  eq(refunds.providerRefundId, event.providerRefundId),
                  ne(refunds.status, 'PROCESSED'),
                ),
              );
          }
          return 'processed';
        default:
          return 'ignored';
      }
    });
  }

  /**
   * Applies a successful payment once. A second report (webhook after checkout, retries) is
   * a no-op. If the amount differs from what we asked for, nothing is confirmed. If the
   * booking can no longer be confirmed (hold expired, cancelled), the money goes back.
   */
  private async capture(
    tx: Tx,
    providerOrderId: string,
    providerPaymentId: string,
    amountPaise: number,
    source: 'checkout' | 'webhook',
  ): Promise<void> {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, providerOrderId))
      .for('update');
    if (!payment) {
      this.logger.warn({ providerOrderId }, 'capture for unknown order');
      return;
    }
    if (
      payment.status === 'CAPTURED' ||
      payment.status === 'REFUNDED' ||
      payment.status === 'PARTIALLY_REFUNDED'
    )
      return;
    if (amountPaise !== payment.amountPaise) {
      await this.audit.record(
        {
          action: 'payment.amount_mismatch',
          entityType: 'payment',
          entityId: payment.id,
          success: false,
          after: { expected: payment.amountPaise, received: amountPaise, providerPaymentId },
        },
        SYSTEM,
        tx,
      );
      this.logger.error(
        { paymentId: payment.id, expected: payment.amountPaise, amountPaise },
        'payment amount mismatch',
      );
      return;
    }
    await tx
      .update(payments)
      .set({ status: 'CAPTURED', providerPaymentId, capturedAt: new Date() })
      .where(eq(payments.id, payment.id));

    const [row] = await tx
      .select({ booking: bookings, instantBook: auditoriums.instantBook })
      .from(bookings)
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .where(eq(bookings.id, payment.bookingId))
      .for('update', { of: bookings });
    if (!row) return;
    const b = row.booking;
    await this.audit.record(
      {
        action: 'payment.captured',
        entityType: 'payment',
        entityId: payment.id,
        after: { bookingId: b.id, amountPaise, source, bookingStatus: b.status },
      },
      SYSTEM,
      tx,
    );

    const payable: BookingStatus[] = ['HELD', 'PENDING_PAYMENT'];
    if (!payable.includes(b.status)) {
      // Paid too late (expired or cancelled meanwhile): refund in full after this commits.
      await this.queueRefund(tx, {
        paymentId: payment.id,
        bookingId: b.id,
        amountPaise,
        purpose: 'late_payment',
        reason: `Payment arrived after the booking was ${b.status.toLowerCase()}`,
      });
      return;
    }
    let version = b.version;
    let status = b.status;
    if (status === 'HELD') {
      await transition(tx, {
        bookingId: b.id,
        from: 'HELD',
        to: 'PENDING_PAYMENT',
        version,
        reason: 'payment_captured',
      });
      version++;
      status = 'PENDING_PAYMENT';
    }
    if (row.instantBook) {
      await transition(tx, {
        bookingId: b.id,
        from: status,
        to: 'CONFIRMED',
        version,
        reason: 'payment_captured',
        set: { holdExpiresAt: null },
      });
    } else {
      const { owner_response_hours } = await this.settings.get(tx);
      await transition(tx, {
        bookingId: b.id,
        from: status,
        to: 'AWAITING_OWNER',
        version,
        reason: 'payment_captured',
        set: {
          holdExpiresAt: null,
          ownerResponseDueAt: new Date(Date.now() + owner_response_hours * 3_600_000),
        },
      });
    }
  }

  // ------------------------------------------------------------ refunds

  /** Creates a PENDING refund row (idempotent by purpose). The provider call happens later. */
  private async queueRefund(
    tx: Tx,
    input: {
      paymentId: string;
      bookingId: string;
      amountPaise: number;
      purpose: string;
      reason: string;
      actorId?: string | null;
    },
  ) {
    await tx
      .insert(refunds)
      .values({
        paymentId: input.paymentId,
        amountPaise: input.amountPaise,
        status: 'PENDING',
        idempotencyKey: `refund:${input.bookingId}:${input.purpose}`,
        reason: input.reason,
        initiatedBy: input.actorId ?? null,
      })
      .onConflictDoNothing();
  }

  /**
   * Refunds up to `amountPaise` of what was captured for a booking. Two phases so no
   * network call happens inside a database transaction: (1) lock the payment, check what is
   * still refundable and record a PENDING refund under a unique idempotency key; (2) call the
   * provider and record the outcome. Retrying the same purpose never refunds twice.
   */
  async refundBooking(input: {
    bookingId: string;
    amountPaise: number;
    purpose: string;
    reason: string;
    actorId?: string | null;
    ctx?: AuditContext;
  }): Promise<{
    refundId: string | null;
    status: 'PROCESSED' | 'PENDING' | 'FAILED' | 'NONE';
    amountPaise: number;
  }> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 0)
      throw errors.badRequest('BAD_AMOUNT', 'Refund amount must be whole paise');
    const refundId = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.idempotencyKey, `refund:${input.bookingId}:${input.purpose}`));
      if (existing) return existing.id;
      const captured = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.bookingId, input.bookingId),
            inArray(payments.status, ['CAPTURED', 'PARTIALLY_REFUNDED']),
          ),
        )
        .for('update');
      const payment = captured.find((p) => p.amountPaise - p.refundedPaise > 0);
      if (!payment || input.amountPaise === 0) return null;
      const [{ pending } = { pending: 0 }] = await tx
        .select({ pending: sql<number>`COALESCE(SUM(${refunds.amountPaise}), 0)::int` })
        .from(refunds)
        .where(and(eq(refunds.paymentId, payment.id), inArray(refunds.status, ['PENDING'])));
      const refundable = payment.amountPaise - payment.refundedPaise - Number(pending);
      if (input.amountPaise > refundable) {
        throw errors.badRequest(
          'REFUND_TOO_LARGE',
          `At most ₹${(refundable / 100).toFixed(2)} can still be refunded`,
        );
      }
      const [row] = await tx
        .insert(refunds)
        .values({
          paymentId: payment.id,
          amountPaise: input.amountPaise,
          status: 'PENDING',
          idempotencyKey: `refund:${input.bookingId}:${input.purpose}`,
          reason: input.reason,
          initiatedBy: input.actorId ?? null,
        })
        .returning({ id: refunds.id });
      return row?.id ?? null;
    });
    if (!refundId) return { refundId: null, status: 'NONE', amountPaise: 0 };
    const status = await this.executeRefund(refundId, input.ctx ?? SYSTEM);
    return { refundId, status, amountPaise: input.amountPaise };
  }

  /** Phase 2 of a refund: call the provider and apply the result. Safe to retry. */
  async executeRefund(
    refundId: string,
    ctx: AuditContext = SYSTEM,
  ): Promise<'PROCESSED' | 'PENDING' | 'FAILED'> {
    const [r] = await this.db
      .select({ refund: refunds, providerPaymentId: payments.providerPaymentId })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .where(eq(refunds.id, refundId));
    if (!r) throw new Error(`refund ${refundId} not found`);
    if (r.refund.status === 'PROCESSED') return 'PROCESSED';
    if (!r.providerPaymentId)
      throw new Error(`payment for refund ${refundId} has no provider payment id`);

    // A refund the gateway already accepted is followed up, never requested again:
    // a second refund() call would start a second refund for the same money.
    const pendingId = r.refund.status === 'PENDING' ? r.refund.providerRefundId : null;
    const followUp = pendingId !== null;
    let outcome: Awaited<ReturnType<PaymentProvider['refund']>>;
    try {
      outcome = pendingId
        ? await this.provider.getRefund({
            providerPaymentId: r.providerPaymentId,
            providerRefundId: pendingId,
          })
        : await this.provider.refund({
            providerPaymentId: r.providerPaymentId,
            amountPaise: r.refund.amountPaise,
            idempotencyKey: r.refund.idempotencyKey,
            reason: r.refund.reason,
          });
    } catch (err) {
      if (followUp) {
        // Could not ask; the refund itself is still under way. Check again later.
        this.logger.warn({ err, refundId }, 'refund status check failed; will check again');
        await this.db
          .update(refunds)
          .set({ updatedAt: new Date() })
          .where(eq(refunds.id, refundId));
        return 'PENDING';
      }
      this.logger.error({ err, refundId }, 'provider refund failed; will retry');
      await this.db
        .update(refunds)
        .set({ status: 'FAILED' })
        .where(and(eq(refunds.id, refundId), eq(refunds.status, 'PENDING')));
      return 'FAILED';
    }
    if (outcome.status !== 'PROCESSED') {
      await this.db
        .update(refunds)
        .set({
          providerRefundId: outcome.providerRefundId,
          status: outcome.status,
          updatedAt: new Date(),
        })
        .where(and(eq(refunds.id, refundId), ne(refunds.status, 'PROCESSED')));
      return outcome.status;
    }

    await this.db.transaction((tx) =>
      this.completeRefund(tx, refundId, outcome.providerRefundId, ctx),
    );
    return 'PROCESSED';
  }

  /**
   * Applies a refund the gateway reports as processed, once: marks it, adds it to the
   * payment, moves a cancelled booking to REFUNDED (which sends the "refund processed"
   * email) and audits it. Reached from the instant path, the follow-up check and the
   * refund.processed webhook, whichever comes first.
   */
  private async completeRefund(
    tx: Tx,
    refundId: string,
    providerRefundId: string | null,
    ctx: AuditContext,
  ): Promise<void> {
    const [locked] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!locked || locked.status === 'PROCESSED') return;
    await tx
      .update(refunds)
      .set({ status: 'PROCESSED', providerRefundId: providerRefundId ?? locked.providerRefundId })
      .where(eq(refunds.id, refundId));
    const [p] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, locked.paymentId))
      .for('update');
    if (!p) return;
    const refunded = p.refundedPaise + locked.amountPaise;
    await tx
      .update(payments)
      .set({
        refundedPaise: refunded,
        status: refunded >= p.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      })
      .where(eq(payments.id, p.id));
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, p.bookingId)).for('update');
    // A cancelled booking is finished once its refund is paid.
    if (b && b.status === 'CANCELLED') {
      await transition(tx, {
        bookingId: b.id,
        from: 'CANCELLED',
        to: 'REFUNDED',
        version: b.version,
        reason: 'refund_processed',
      });
    }
    await this.audit.record(
      {
        action: 'payment.refunded',
        entityType: 'payment',
        entityId: p.id,
        actorId: locked.initiatedBy,
        after: {
          refundId,
          amountPaise: locked.amountPaise,
          reason: locked.reason,
          bookingId: p.bookingId,
        },
      },
      ctx,
      tx,
    );
  }

  /**
   * Owner rejects a paid request, or fails to answer in time: the booking is cancelled and
   * everything paid online (including the platform fee) is refunded.
   */
  async cancelAwaitingOwner(
    bookingId: string,
    reason: 'rejected_by_owner' | 'owner_response_timeout',
    actorId: string | null,
    ctx: AuditContext = SYSTEM,
  ) {
    const paid = await this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
      if (!b) throw errors.notFound('Booking not found');
      if (b.status !== 'AWAITING_OWNER')
        throw errors.conflict(
          'INVALID_TRANSITION',
          'Only bookings waiting for the venue can be declined',
        );
      const [{ total } = { total: 0 }] = await tx
        .select({
          total: sql<number>`COALESCE(SUM(${payments.amountPaise} - ${payments.refundedPaise}), 0)::int`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.bookingId, b.id),
            inArray(payments.status, ['CAPTURED', 'PARTIALLY_REFUNDED']),
          ),
        );
      try {
        await transition(tx, {
          bookingId: b.id,
          from: 'AWAITING_OWNER',
          to: 'CANCELLED',
          version: b.version,
          actorId,
          reason,
          set: {
            cancelledAt: new Date(),
            cancelledBy: actorId,
            cancellationReason: reason,
            refundDuePaise: Number(total),
          },
        });
      } catch (err) {
        if (err instanceof StaleBookingError)
          throw errors.conflict(
            'BOOKING_CHANGED',
            'This booking just changed. Reload and try again.',
          );
        throw err;
      }
      await this.audit.record(
        {
          action: 'booking.declined',
          entityType: 'booking',
          entityId: b.id,
          actorId,
          after: { reason, refundPaise: Number(total) },
        },
        ctx,
        tx,
      );
      return Number(total);
    });
    return this.refundBooking({
      bookingId,
      amountPaise: paid,
      purpose: reason,
      reason,
      actorId,
      ctx,
    });
  }

  /** Worker: decline requests the owner did not answer in time. */
  async declineOverdueRequests(limit = 100): Promise<number> {
    const overdue = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(eq(bookings.status, 'AWAITING_OWNER'), lt(bookings.ownerResponseDueAt, new Date())),
      )
      .limit(limit);
    let n = 0;
    for (const b of overdue) {
      try {
        await this.cancelAwaitingOwner(b.id, 'owner_response_timeout', null);
        n++;
      } catch (err) {
        this.logger.warn({ err, bookingId: b.id }, 'could not decline overdue request');
      }
    }
    return n;
  }

  /**
   * Worker: execute queued refunds, retry failed ones, and check on refunds the gateway
   * accepted but has not finished (in case its webhook never arrives). Those checks are
   * spaced out: gateway refunds can take days.
   */
  async retryRefunds(
    limit = 50,
    minAgeMs = 30_000,
    followUpEveryMs = 10 * 60_000,
  ): Promise<number> {
    const now = Date.now();
    const due = await this.db
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        or(
          and(
            or(
              eq(refunds.status, 'FAILED'),
              and(eq(refunds.status, 'PENDING'), isNull(refunds.providerRefundId)),
            ),
            lt(refunds.updatedAt, new Date(now - minAgeMs)),
          ),
          and(
            eq(refunds.status, 'PENDING'),
            isNotNull(refunds.providerRefundId),
            lt(refunds.updatedAt, new Date(now - followUpEveryMs)),
          ),
        ),
      )
      .limit(limit);
    let n = 0;
    for (const r of due) {
      if ((await this.executeRefund(r.id)) === 'PROCESSED') n++;
    }
    return n;
  }
}
