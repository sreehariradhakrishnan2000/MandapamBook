import { createServer } from 'node:http';
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { initErrorTracking } from './infra/error-tracking.js';
import { buildContainer } from './container.js';
import { createDb } from './db/client.js';
import { createApp } from './http/app.js';
import { createPgPool, createRedis } from './infra/connections.js';
import { RedisRevocationStore } from './infra/revocation-store.js';
import { createObjectStorage } from './infra/storage.js';
import { type Sweeps, startSweeps } from './jobs/scheduler.js';
import {
  ConsoleSmsSender,
  SmtpEmailSender,
  createEmailSender,
} from './modules/notifications/senders.js';

async function main(): Promise<void> {
  const env = loadEnv(); // fail fast on bad config
  const logger = createLogger(env);
  await initErrorTracking({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV ?? env.NODE_ENV,
    release: (process.env['APP_VERSION'] ?? 'dev').slice(0, 12),
    logger,
  });
  const pool = createPgPool(env, logger);
  const redis = createRedis(env);
  redis.on('error', (err) => logger.warn({ err }, 'redis error'));
  await redis
    .connect()
    .catch((err: unknown) => logger.warn({ err }, 'redis not reachable at startup'));

  const storage = createObjectStorage(env);

  // loadEnv refuses EMAIL_PROVIDER=console in production.
  const email = createEmailSender(env, logger.child({ component: 'email' }));
  // A wrong SMTP host or password shows up in the logs at startup, not at the first reset.
  if (email instanceof SmtpEmailSender) void email.verify();
  const container = buildContainer({
    env,
    logger,
    db: createDb(pool),
    redis,
    revocations: new RedisRevocationStore(redis),
    email,
    sms: new ConsoleSmsSender(logger),
    storage,
  });

  const app = createApp({
    env,
    logger,
    api: container.api,
    readinessChecks: {
      database: async () => {
        await pool.query('SELECT 1');
      },
      redis: async () => {
        await redis.ping();
      },
    },
  });

  const server = createServer(app);
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'api listening'));

  // No separate worker on this host (e.g. a free tier without workers): sweep in-process.
  const sweeps: Sweeps | null = env.RUN_JOBS_IN_PROCESS
    ? startSweeps({
        env,
        logger: logger.child({ component: 'sweeps' }),
        pool,
        db: createDb(pool),
        storage,
      })
    : null;

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void Promise.all([sweeps?.stop(), container.directEmail.drain()])
        .then(() => Promise.allSettled([pool.end(), redis.quit()]))
        .then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  // The logger may not exist yet (env failure), so write plainly to stderr.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
