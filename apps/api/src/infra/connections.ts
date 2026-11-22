import { Redis } from 'ioredis';
import pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';

export function createPgPool(env: Pick<Env, 'DATABASE_URL'>, logger?: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
  });
  // An idle client can be dropped by the server or a proxy (e.g. ECONNRESET). Without this
  // handler node-postgres re-throws it as an uncaught exception and the process dies; the
  // pool already discards the broken client and opens a new one on the next query.
  pool.on('error', (err) => logger?.warn({ err }, 'idle database connection lost'));
  return pool;
}

export function createRedis(env: Pick<Env, 'REDIS_URL'>): Redis {
  return new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
}
