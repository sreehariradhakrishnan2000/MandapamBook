/**
 * Background worker: runs the maintenance sweep every SWEEP_INTERVAL_SECONDS.
 * Same image as the API, different command (`node dist/worker.js`). Run one or more;
 * the sweep's advisory lock keeps them from overlapping.
 */
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDb } from './db/client.js';
import { createPgPool } from './infra/connections.js';
import { MemoryObjectStorage, type ObjectStorage, S3ObjectStorage } from './infra/storage.js';
import { AuditService } from './modules/audit/audit.service.js';
import { BookingService } from './modules/bookings/booking.service.js';
import { QuoteService } from './modules/bookings/quote.service.js';
import { createPaymentProvider } from './modules/payments/factory.js';
import { PaymentService } from './modules/payments/payment.service.js';
import { SettingsService } from './modules/settings/settings.service.js';
import { runSweep } from './jobs/sweeper.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env).child({ component: 'worker' });
  const pool = createPgPool(env, logger);
  const db = createDb(pool);
  const settings = new SettingsService(db);
  const bookingService = new BookingService(
    db,
    new QuoteService(db, settings),
    settings,
    new AuditService(db, logger),
  );
  const payments = new PaymentService(
    db,
    createPaymentProvider(env),
    settings,
    new AuditService(db, logger),
    logger,
  );
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

  const intervalMs = Number(process.env['SWEEP_INTERVAL_SECONDS'] ?? 30) * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSweep({ pool, db, bookingService, storage, payments, logger });
    } catch (err) {
      logger.error({ err }, 'sweep failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  logger.info({ intervalMs }, 'worker started');

  const stop = (signal: string) => {
    logger.info({ signal }, 'worker stopping');
    clearInterval(timer);
    const wait = setInterval(() => {
      if (!running) {
        clearInterval(wait);
        void pool.end().then(() => process.exit(0));
      }
    }, 100);
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
