import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { bookingStatusHistory, bookings } from '../../db/schema/index.js';

export type BookingStatus = (typeof bookings.$inferSelect)['status'];

/**
 * Every legal booking transition. Anything not listed throws IllegalTransitionError.
 *
 *   HELD ─▶ PENDING_PAYMENT ─▶ CONFIRMED ─▶ COMPLETED
 *     │            │      └──▶ AWAITING_OWNER ─▶ CONFIRMED
 *     │            │                   └──────▶ REFUNDED   (owner rejects / times out)
 *     ├▶ EXPIRED ◀─┤
 *     └▶ CANCELLED ◀┴── CONFIRMED / AWAITING_OWNER ──▶ CANCELLED ─▶ REFUNDED
 */
export const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  HELD: ['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'],
  PENDING_PAYMENT: ['CONFIRMED', 'AWAITING_OWNER', 'EXPIRED', 'CANCELLED'],
  AWAITING_OWNER: ['CONFIRMED', 'REFUNDED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
  CANCELLED: ['REFUNDED'],
  COMPLETED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export class IllegalTransitionError extends Error {
  override name = 'IllegalTransitionError';
  constructor(
    readonly from: BookingStatus,
    readonly to: BookingStatus,
  ) {
    super(`booking cannot move from ${from} to ${to}`);
  }
}

/** Optimistic-lock failure: someone else changed the booking first. */
export class StaleBookingError extends Error {
  override name = 'StaleBookingError';
  constructor(readonly bookingId: string) {
    super(`booking ${bookingId} was changed concurrently`);
  }
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface TransitionInput {
  bookingId: string;
  from: BookingStatus;
  to: BookingStatus;
  /** The version the caller read; the update applies only if it is still current. */
  version: number;
  actorId?: string | null;
  reason?: string | null;
  set?: Partial<typeof bookings.$inferInsert>;
}

/**
 * Applies one transition inside the caller's transaction: validates it, updates the row
 * only if status and version are unchanged (so concurrent writers cannot both succeed),
 * bumps the version and records history. The hall_occupancy trigger frees or keeps the
 * slot to match the new status.
 */
export async function transition(tx: Tx, input: TransitionInput) {
  assertTransition(input.from, input.to);
  const [row] = await tx
    .update(bookings)
    .set({ ...input.set, status: input.to, version: input.version + 1 })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.status, input.from),
        eq(bookings.version, input.version),
      ),
    )
    .returning();
  if (!row) throw new StaleBookingError(input.bookingId);
  await tx.insert(bookingStatusHistory).values({
    bookingId: input.bookingId,
    fromStatus: input.from,
    toStatus: input.to,
    actorId: input.actorId ?? null,
    reason: input.reason ?? null,
  });
  return row;
}
