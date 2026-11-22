import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { auditoriums, bookings, payments, payouts } from '../../db/schema/index.js';
import type { SettingsService } from '../settings/settings.service.js';

export interface PayoutAmounts {
  grossPaise: number;
  commissionPaise: number;
  netPaise: number;
}

/**
 * What the platform owes the venue for one booking, from the online money it holds.
 * Completed events: commission on venue charges (hall + add-ons, before GST), capped at
 * what was collected. Cancellations: the venue keeps the non-refunded share and commission
 * applies to that share only. The platform fee is never the venue's.
 */
export function payoutFor(input: {
  status: string;
  capturedPaise: number;
  refundedPaise: number;
  platformFeePaise: number;
  venueChargesPaise: number;
  commissionBps: number;
}): PayoutAmounts {
  const gross = Math.max(0, input.capturedPaise - input.refundedPaise - input.platformFeePaise);
  const base = input.status === 'COMPLETED' ? input.venueChargesPaise : gross;
  const commission = Math.min(gross, Math.round((base * input.commissionBps) / 10_000));
  return { grossPaise: gross, commissionPaise: commission, netPaise: gross - commission };
}

export class PayoutService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Records payouts for bookings that are settled: completed, or cancelled with no refund
   * still owed. Idempotent (one payout per booking), so the worker can run it every sweep.
   */
  async accrue(limit = 200): Promise<number> {
    const { commission_bps } = await this.settings.get();
    const settled = await this.db
      .select({
        id: bookings.id,
        status: bookings.status,
        ownerId: auditoriums.ownerId,
        subtotal: bookings.subtotalPaise,
        addons: bookings.addonsPaise,
        fee: bookings.platformFeePaise,
        captured: sql<string>`COALESCE((SELECT SUM(p.amount_paise) FROM payments p WHERE p.booking_id = ${bookings.id} AND p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED')), 0)`,
        refunded: sql<string>`COALESCE((SELECT SUM(p.refunded_paise) FROM payments p WHERE p.booking_id = ${bookings.id}), 0)`,
      })
      .from(bookings)
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .leftJoin(payouts, eq(payouts.bookingId, bookings.id))
      .where(
        and(
          isNull(payouts.id),
          or(
            eq(bookings.status, 'COMPLETED'),
            and(
              inArray(bookings.status, ['CANCELLED', 'REFUNDED']),
              or(isNull(bookings.refundDuePaise), eq(bookings.refundDuePaise, 0)),
            ),
          ),
          sql`EXISTS (SELECT 1 FROM ${payments} p WHERE p.booking_id = ${bookings.id} AND p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED'))`,
        ),
      )
      .limit(limit);
    let created = 0;
    for (const b of settled) {
      const amounts = payoutFor({
        status: b.status,
        capturedPaise: Number(b.captured),
        refundedPaise: Number(b.refunded),
        platformFeePaise: b.fee,
        venueChargesPaise: b.subtotal + b.addons,
        commissionBps: commission_bps,
      });
      if (amounts.grossPaise === 0) continue;
      const rows = await this.db
        .insert(payouts)
        .values({ ownerId: b.ownerId, bookingId: b.id, ...amounts })
        .onConflictDoNothing()
        .returning({ id: payouts.id });
      created += rows.length;
    }
    return created;
  }
}
