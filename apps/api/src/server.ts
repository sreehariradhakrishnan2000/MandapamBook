import { createServer } from 'node:http';
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { buildContainer } from './container.js';
import { createDb } from './db/client.js';
import { createApp } from './http/app.js';
import { createPgPool, createRedis } from './infra/connections.js';
import { RedisRevocationStore } from './infra/revocation-store.js';
import { MemoryObjectStorage, type ObjectStorage, S3ObjectStorage } from './infra/storage.js';
import { createEmailSender, ConsoleSmsSender } from './modules/notifications/senders.js';

async function main(): Promise<void> {
  const env = loadEnv(); // fail fast on bad config
  const logger = createLogger(env);
  const pool = createPgPool(env, logger);
  const redis = createRedis(env);
  redis.on('error', (err) => logger.warn({ err }, 'redis error'));
  await redis
    .connect()
    .catch((err: unknown) => logger.warn({ err }, 'redis not reachable at startup'));

  const storage: ObjectStorage =
    env.STORAGE_PROVIDER === 's3'
      ? new S3ObjectStorage({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : new MemoryObjectStorage();

  // loadEnv refuses EMAIL_PROVIDER=console in production.
  const container = buildContainer({
    env,
    logger,
    db: createDb(pool),
    redis,
    revocations: new RedisRevocationStore(redis),
    email: createEmailSender(env, logger),
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

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void Promise.allSettled([pool.end(), redis.quit()]).then(() => process.exit(0));
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
