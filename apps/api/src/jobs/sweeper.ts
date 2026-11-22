import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Logger } from 'pino';
import type pg from 'pg';
import type { Db } from '../db/client.js';
import { bookings, media } from '../db/schema/index.js';
import type { ObjectStorage } from '../infra/storage.js';
import { todayInIst } from '../lib/time.js';
import type { BookingService } from '../modules/bookings/booking.service.js';
import type { PaymentService } from '../modules/payments/payment.service.js';
import { transition } from '../modules/bookings/state-machine.js';

/** Arbitrary constant: only one process at a time may run the sweep. */
const SWEEP_LOCK_KEY = 7_420_001;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  ran: boolean;
  expiredHolds: number;
  completed: number;
  removedUploads: number;
  declinedRequests: number;
  refundsProcessed: number;
}

/**
 * Periodic maintenance. The database is the source of truth, so this is safe to run
 * from any number of workers: a session advisory lock lets one sweep at a time, and
 * every row is updated through the state machine with row locks.
 *
 * - Unpaid holds past their expiry → EXPIRED (frees the slot)
 * - Confirmed bookings whose date has passed (IST) → COMPLETED
 * - Photo uploads never confirmed within 24 hours → deleted from storage and the DB
 * - Paid requests the owner did not answer in time → cancelled with a full refund
 * - Queued or failed refunds → sent to the payment provider again
 */
export async function runSweep(deps: {
  pool: pg.Pool;
  db: Db;
  bookingService: BookingService;
  storage: ObjectStorage;
  payments?: PaymentService;
  logger: Logger;
}): Promise<SweepResult> {
  const { pool, db, bookingService, storage, logger } = deps;
  const client = await pool.connect();
  let broken: Error | undefined;
  // A failure on the lock connection itself must not crash the worker.
  const onClientError = (err: Error) => {
    broken = err;
    logger.warn({ err }, 'sweep lock connection lost');
  };
  client.on('error', onClientError);
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [SWEEP_LOCK_KEY],
    );
    if (!rows[0]?.locked)
      return {
        ran: false,
        expiredHolds: 0,
        completed: 0,
        removedUploads: 0,
        declinedRequests: 0,
        refundsProcessed: 0,
      };
    try {
      const expiredHolds = await db.transaction((tx) => bookingService.expireStale(tx));

      const completed = await db.transaction(async (tx) => {
        const past = await tx
          .select({ id: bookings.id, version: bookings.version })
          .from(bookings)
          .where(and(eq(bookings.status, 'CONFIRMED'), lt(bookings.eventDate, todayInIst())))
          .limit(500)
          .for('update', { skipLocked: true });
        for (const b of past) {
          await transition(tx, {
            bookingId: b.id,
            from: 'CONFIRMED',
            to: 'COMPLETED',
            version: b.version,
            reason: 'event_date_passed',
          });
        }
        return past.length;
      });

      const stale = await db
        .select({ id: media.id, storageKey: media.storageKey })
        .from(media)
        .where(
          and(
            eq(media.status, 'PENDING_UPLOAD'),
            lt(media.createdAt, new Date(Date.now() - UPLOAD_TTL_MS)),
          ),
        )
        .limit(200);
      for (const m of stale) await storage.delete(m.storageKey).catch(() => undefined);
      if (stale.length)
        await db.delete(media).where(
          inArray(
            media.id,
            stale.map((m) => m.id),
          ),
        );

      const declinedRequests = deps.payments ? await deps.payments.declineOverdueRequests() : 0;
      const refundsProcessed = deps.payments ? await deps.payments.retryRefunds() : 0;

      const result = {
        ran: true,
        expiredHolds,
        completed,
        removedUploads: stale.length,
        declinedRequests,
        refundsProcessed,
      };
      if (expiredHolds || completed || stale.length || declinedRequests || refundsProcessed)
        logger.info(result, 'sweep finished');
      return result;
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]);
      } catch (err) {
        // The lock connection broke. Closing it releases the session lock server-side.
        broken = err instanceof Error ? err : new Error(String(err));
      }
    }
  } finally {
    client.off('error', onClientError);
    client.release(broken);
  }
}
