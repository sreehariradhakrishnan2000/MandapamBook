import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

/** Postgres error codes the application maps to HTTP responses. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const;

/** Advisory-lock namespace (first key) for hall/date occupancy writes. */
const HALL_DATE_LOCK_NAMESPACE = 7301;

/**
 * Serializes writes to one hall's occupancy on one date, until the transaction ends.
 *
 * hall_occupancy's exclusion constraint is checked after each insert adds its own index
 * entry, so concurrent conflicting inserts wait on each other and deadlock (40P01): Postgres
 * aborts all but one after deadlock_timeout (1 s each). Taking this lock before checking
 * availability makes them queue instead; the later ones then see the slot taken. It is per
 * hall and date, not per slot, because FULL_DAY overlaps MORNING and EVENING.
 */
export async function lockHallDate(tx: Tx, hallId: string, eventDate: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${HALL_DATE_LOCK_NAMESPACE}, hashtext(${`${hallId}:${eventDate}`}))`,
  );
}

export function pgErrorCode(err: unknown): string | undefined {
  // Drizzle wraps driver errors; the pg error is on .cause.
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/** Name of the violated constraint or index, when Postgres reports one. */
export function pgConstraint(err: unknown): string | undefined {
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const name = (e as { constraint?: unknown }).constraint;
    if (typeof name === 'string') return name;
  }
  return undefined;
}
