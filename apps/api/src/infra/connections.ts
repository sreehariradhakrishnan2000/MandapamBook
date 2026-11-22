import { Redis } from 'ioredis';
import pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';

/** Errors meaning the TCP connection died, not that the statement itself failed. */
const CONNECTION_LOST = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']);

export function isConnectionLost(err: unknown): boolean {
  const code = (err as { code?: unknown; cause?: { code?: unknown } } | null)?.code;
  const causeCode = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return (
    CONNECTION_LOST.has(String(code)) ||
    CONNECTION_LOST.has(String(causeCode)) ||
    (err instanceof Error && /Connection terminated unexpectedly/.test(err.message))
  );
}

function statementText(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && 'text' in first) return String(first.text);
  return '';
}

/**
 * A pooled connection can be dropped by the server or a proxy (Neon, NAT) between uses;
 * the next statement on it then fails with ECONNRESET. Plain SELECTs sent through the pool
 * (not inside a transaction) are retried once on a fresh connection: a read has no side
 * effects, so this is safe. Writes and transactions are never retried here.
 */
export function withReadRetry(pool: pg.Pool, logger?: Logger): pg.Pool {
  const original = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  const retrying = async (...args: unknown[]): Promise<unknown> => {
    if (typeof args.at(-1) === 'function') return original(...args); // callback style: untouched
    try {
      return await original(...args);
    } catch (err) {
      if (!isConnectionLost(err) || !/^\s*select\b/i.test(statementText(args))) throw err;
      logger?.warn({ err }, 'database connection lost during a read; retrying once');
      return original(...args);
    }
  };
  (pool as unknown as { query: typeof retrying }).query = retrying;
  return pool;
}

export function createPgPool(env: Pick<Env, 'DATABASE_URL'>, logger?: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    // Recycle idle connections before typical proxy idle cut-offs.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  // An idle client can be dropped by the server or a proxy (e.g. ECONNRESET). Without this
  // handler node-postgres re-throws it as an uncaught exception and the process dies; the
  // pool already discards the broken client and opens a new one on the next query.
  pool.on('error', (err) => logger?.warn({ err }, 'idle database connection lost'));
  return withReadRetry(pool, logger);
}

export function createRedis(
  env: Pick<Env, 'REDIS_URL'> & Partial<Pick<Env, 'REDIS_KEY_PREFIX'>>,
): Redis {
  return new Redis(env.REDIS_URL, {
    ...(env.REDIS_KEY_PREFIX ? { keyPrefix: env.REDIS_KEY_PREFIX } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
}
