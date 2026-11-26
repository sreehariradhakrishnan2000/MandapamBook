import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { auditoriums, bookings, payments, refunds } from '../../db/schema/index.js';

/** What a customer sees about the money going back to them for one booking. */
export interface RefundStatus {
  amountPaise: number;
  /** PROCESSING until the gateway reports every refund for the booking as processed. */
  status: 'PROCESSING' | 'COMPLETED';
  startedAt: string;
  completedAt: string | null;
  /** The gateway's refund id, which a bank can trace. */
  reference: string | null;
}

interface RefundRow {
  bookingId: string;
  amountPaise: number;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  providerRefundId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Completed refunds stay in the site-wide notice for this long. */
export const COMPLETED_NOTICE_DAYS = 14;

/**
 * Refund status per booking. A refund the gateway has not finished (or one being retried
 * after a failure) is PROCESSING: we keep retrying, so to the customer it is on its way.
 * A cancellation with money owed but no refund row yet (the gateway call is queued) also
 * counts as PROCESSING from the cancellation time.
 */
export async function refundStatuses(
  db: Db,
  bookingRows: { id: string; refundDuePaise: number | null; cancelledAt: Date | null }[],
): Promise<Map<string, RefundStatus>> {
  const out = new Map<string, RefundStatus>();
  if (bookingRows.length === 0) return out;
  const rows: RefundRow[] = await db
    .select({
      bookingId: payments.bookingId,
      amountPaise: refunds.amountPaise,
      status: refunds.status,
      providerRefundId: refunds.providerRefundId,
      createdAt: refunds.createdAt,
      updatedAt: refunds.updatedAt,
    })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(
      inArray(
        payments.bookingId,
        bookingRows.map((b) => b.id),
      ),
    );

  const byBooking = new Map<string, RefundRow[]>();
  for (const r of rows) byBooking.set(r.bookingId, [...(byBooking.get(r.bookingId) ?? []), r]);
  for (const b of bookingRows) {
    const list = byBooking.get(b.id) ?? [];
    if (list.length === 0) {
      if (b.refundDuePaise && b.refundDuePaise > 0 && b.cancelledAt) {
        out.set(b.id, {
          amountPaise: b.refundDuePaise,
          status: 'PROCESSING',
          startedAt: b.cancelledAt.toISOString(),
          completedAt: null,
          reference: null,
        });
      }
      continue;
    }
    const done = list.every((r) => r.status === 'PROCESSED');
    const started = Math.min(...list.map((r) => r.createdAt.getTime()));
    const finished = Math.max(...list.map((r) => r.updatedAt.getTime()));
    out.set(b.id, {
      amountPaise: list.reduce((sum, r) => sum + r.amountPaise, 0),
      status: done ? 'COMPLETED' : 'PROCESSING',
      startedAt: new Date(started).toISOString(),
      completedAt: done ? new Date(finished).toISOString() : null,
      reference: list.find((r) => r.providerRefundId)?.providerRefundId ?? null,
    });
  }
  return out;
}

/**
 * For the site-wide notice: the customer's refunds still on their way, and those completed
 * in the last COMPLETED_NOTICE_DAYS days.
 */
export async function refundUpdates(
  db: Db,
  customerId: string,
  now = new Date(),
): Promise<{ bookingId: string; refCode: string; venueName: string; refund: RefundStatus }[]> {
  const candidates = await db
    .selectDistinct({
      id: bookings.id,
      refCode: bookings.refCode,
      venueName: auditoriums.name,
      refundDuePaise: bookings.refundDuePaise,
      cancelledAt: bookings.cancelledAt,
    })
    .from(bookings)
    .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.customerId, customerId),
        inArray(bookings.status, ['CANCELLED', 'REFUNDED', 'EXPIRED']),
      ),
    )
    .limit(50);
  const statuses = await refundStatuses(db, candidates);
  const cutoff = now.getTime() - COMPLETED_NOTICE_DAYS * 86_400_000;
  return candidates
    .flatMap((b) => {
      const refund = statuses.get(b.id);
      if (!refund) return [];
      if (refund.status === 'COMPLETED' && Date.parse(refund.completedAt ?? '') < cutoff) return [];
      return [{ bookingId: b.id, refCode: b.refCode, venueName: b.venueName, refund }];
    })
    .sort((a, b) => b.refund.startedAt.localeCompare(a.refund.startedAt));
}
