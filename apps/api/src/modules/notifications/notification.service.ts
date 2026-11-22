import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import {
  auditoriums,
  bookingStatusHistory,
  bookings,
  halls,
  notifications,
  payments,
  users,
} from '../../db/schema/index.js';
import type { InvoiceService } from '../invoices/invoice.service.js';
import type { EmailSender } from './senders.js';
import {
  type BookingNotificationData,
  type BookingTemplate,
  renderBookingEmail,
} from './templates.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type HistoryRow = typeof bookingStatusHistory.$inferSelect;

export const MAX_ATTEMPTS = 5;
const DECLINE_REASONS = new Set(['rejected_by_owner', 'owner_response_timeout']);

interface Recipient {
  userId: string;
  template: BookingTemplate;
}

/** Which messages a booking transition produces. Pure, so the rules are unit-tested. */
export function notificationsFor(
  h: Pick<HistoryRow, 'fromStatus' | 'toStatus' | 'reason'>,
  customerId: string,
  ownerId: string,
): Recipient[] {
  switch (h.toStatus) {
    case 'CONFIRMED':
      return [
        { userId: customerId, template: 'booking_confirmed' },
        { userId: ownerId, template: 'owner_new_booking' },
      ];
    case 'AWAITING_OWNER':
      return [
        { userId: customerId, template: 'booking_requested' },
        { userId: ownerId, template: 'owner_request_pending' },
      ];
    case 'CANCELLED': {
      const wasPaid = h.fromStatus === 'CONFIRMED' || h.fromStatus === 'AWAITING_OWNER';
      if (h.reason && DECLINE_REASONS.has(h.reason))
        return [{ userId: customerId, template: 'booking_declined' }];
      return [
        { userId: customerId, template: 'booking_cancelled' },
        ...(wasPaid ? [{ userId: ownerId, template: 'owner_booking_cancelled' as const }] : []),
      ];
    }
    case 'REFUNDED':
      return [{ userId: customerId, template: 'refund_processed' }];
    case 'EXPIRED':
      // Only worth telling someone who had started paying.
      return h.fromStatus === 'PENDING_PAYMENT'
        ? [{ userId: customerId, template: 'hold_expired' }]
        : [];
    case 'COMPLETED':
      return [{ userId: customerId, template: 'review_request' }];
    default:
      return [];
  }
}

/** Minutes to wait before attempt n (1-based): 1, 2, 4, 8 ... capped at an hour. */
export function backoffMinutes(attempt: number): number {
  return Math.min(60, 2 ** Math.max(0, attempt - 1));
}

/**
 * Transactional outbox. Booking transitions already write booking_status_history in the
 * same transaction as the change, so the worker turns unprocessed history rows into queued
 * notifications (deduplicated per transition and recipient), then delivers them with retries.
 * A crash between steps can only delay a message, never lose or duplicate it.
 */
export class NotificationService {
  constructor(
    private readonly db: Db,
    private readonly email: EmailSender,
    private readonly invoices: InvoiceService,
    private readonly appBaseUrl: string,
    private readonly logger: Logger,
  ) {}

  async processOutbox(limit = 200): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          h: bookingStatusHistory,
          b: bookings,
          ownerId: auditoriums.ownerId,
          venueName: auditoriums.name,
          hallName: halls.name,
        })
        .from(bookingStatusHistory)
        .innerJoin(bookings, eq(bookings.id, bookingStatusHistory.bookingId))
        .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
        .innerJoin(halls, eq(halls.id, bookings.hallId))
        .where(isNull(bookingStatusHistory.notifiedAt))
        .orderBy(asc(bookingStatusHistory.createdAt))
        .limit(limit)
        .for('update', { of: bookingStatusHistory, skipLocked: true });
      let queued = 0;
      for (const { h, b, ownerId, venueName, hallName } of rows) {
        const recipients = notificationsFor(h, b.customerId, ownerId);
        if (recipients.length) {
          const paid = await this.paid(tx, b.id);
          const base = {
            bookingId: b.id,
            refCode: b.refCode,
            venueName,
            hallName,
            eventDate: b.eventDate,
            slot: b.slot,
            totalPaise: b.totalPaise,
            paidPaise: paid.captured,
            refundPaise: h.toStatus === 'REFUNDED' ? paid.refunded : (b.refundDuePaise ?? 0),
          };
          const inserted = await tx
            .insert(notifications)
            .values(
              recipients.map((r) => ({
                userId: r.userId,
                channel: 'EMAIL' as const,
                template: r.template,
                data: base,
                dedupeKey: `${r.template}:${h.id}:${r.userId}`,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: notifications.id });
          queued += inserted.length;
        }
        await tx
          .update(bookingStatusHistory)
          .set({ notifiedAt: new Date() })
          .where(eq(bookingStatusHistory.id, h.id));
      }
      return queued;
    });
  }

  private async paid(tx: Tx, bookingId: string): Promise<{ captured: number; refunded: number }> {
    const [row] = await tx
      .select({
        captured: sql<string>`COALESCE(SUM(${payments.amountPaise}), 0)`,
        refunded: sql<string>`COALESCE(SUM(${payments.refundedPaise}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.bookingId, bookingId),
          inArray(payments.status, ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED']),
        ),
      );
    return { captured: Number(row?.captured ?? 0), refunded: Number(row?.refunded ?? 0) };
  }

  /** Sends queued notifications that are due. Failures back off and give up after 5 tries. */
  async deliverDue(limit = 50): Promise<{ sent: number; failed: number }> {
    const due = await this.db
      .select({ n: notifications, email: users.email, name: users.fullName })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(and(eq(notifications.status, 'QUEUED'), lte(notifications.nextAttemptAt, new Date())))
      .orderBy(asc(notifications.nextAttemptAt))
      .limit(limit);
    let sent = 0;
    let failed = 0;
    for (const { n, email, name } of due) {
      // Claim the row so two workers never send the same message.
      const claimed = await this.db
        .update(notifications)
        .set({
          attempts: n.attempts + 1,
          nextAttemptAt: new Date(Date.now() + backoffMinutes(n.attempts + 1) * 60_000),
        })
        .where(
          and(
            eq(notifications.id, n.id),
            eq(notifications.status, 'QUEUED'),
            eq(notifications.attempts, n.attempts),
          ),
        )
        .returning({ id: notifications.id });
      if (!claimed.length) continue;
      try {
        const data = {
          ...(n.data as BookingNotificationData),
          recipientName: name.split(' ')[0] ?? name,
        };
        const template = n.template as BookingTemplate;
        const { subject, text } = renderBookingEmail(template, data, this.appBaseUrl);
        const attachments =
          template === 'booking_confirmed'
            ? await this.invoices.pdf(data.bookingId).then(
                ({ data: inv, buffer }) => [
                  {
                    filename: `${inv.number.replaceAll('/', '-')}.pdf`,
                    content: buffer,
                    contentType: 'application/pdf',
                  },
                ],
                (err: unknown) => {
                  this.logger.warn({ err, bookingId: data.bookingId }, 'invoice not attached');
                  return undefined;
                },
              )
            : undefined;
        await this.email.send({
          to: email,
          template,
          subject,
          text,
          ...(attachments ? { attachments } : {}),
        });
        await this.db
          .update(notifications)
          .set({ status: 'SENT', sentAt: new Date(), lastError: null })
          .where(eq(notifications.id, n.id));
        sent++;
      } catch (err) {
        failed++;
        const giveUp = n.attempts + 1 >= MAX_ATTEMPTS;
        await this.db
          .update(notifications)
          .set({ status: giveUp ? 'FAILED' : 'QUEUED', lastError: String(err).slice(0, 500) })
          .where(eq(notifications.id, n.id));
        this.logger.warn({ err, notificationId: n.id, giveUp }, 'notification delivery failed');
      }
    }
    return { sent, failed };
  }
}
