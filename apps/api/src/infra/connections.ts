import { Redis } from 'ioredis';
import pg from 'pg';
import type { Env } from '../config/env.js';

export function createPgPool(env: Pick<Env, 'DATABASE_URL'>): pg.Pool {
  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createRedis(env: Pick<Env, 'REDIS_URL'>): Redis {
  return new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
}
