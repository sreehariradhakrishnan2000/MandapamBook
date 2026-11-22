/**
 * Background worker: runs the maintenance sweep every SWEEP_INTERVAL_SECONDS.
 * Same image as the API, different command (`node dist/worker.js`). Run one or more;
 * the sweep's advisory lock keeps them from overlapping. On hosts without a free worker
 * tier, set RUN_JOBS_IN_PROCESS=true on the API instead (see jobs/scheduler.ts).
 */
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDb } from './db/client.js';
import { createPgPool } from './infra/connections.js';
import { createObjectStorage } from './infra/storage.js';
import { startSweeps } from './jobs/scheduler.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env).child({ component: 'worker' });
  const pool = createPgPool(env, logger);
  const sweeps = startSweeps({
    env,
    logger,
    pool,
    db: createDb(pool),
    storage: createObjectStorage(env),
  });

  const stop = (signal: string) => {
    logger.info({ signal }, 'worker stopping');
    setTimeout(() => process.exit(1), 15_000).unref();
    void sweeps
      .stop()
      .then(() => pool.end())
      .then(() => process.exit(0));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
