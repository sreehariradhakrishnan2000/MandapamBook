import { createServer } from 'node:http';
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createApp } from './http/app.js';
import { createPgPool, createRedis } from './infra/connections.js';

async function main(): Promise<void> {
  const env = loadEnv(); // fail fast on bad config
  const logger = createLogger(env);
  const pool = createPgPool(env);
  const redis = createRedis(env);
  redis.on('error', (err) => logger.warn({ err }, 'redis error'));
  await redis
    .connect()
    .catch((err: unknown) => logger.warn({ err }, 'redis not reachable at startup'));

  const app = createApp({
    env,
    logger,
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
