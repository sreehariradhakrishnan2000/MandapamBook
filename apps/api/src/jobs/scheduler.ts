import type { Logger } from 'pino';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import type { ObjectStorage } from '../infra/storage.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { BookingService } from '../modules/bookings/booking.service.js';
import { QuoteService } from '../modules/bookings/quote.service.js';
import { InvoiceService } from '../modules/invoices/invoice.service.js';
import { NotificationService } from '../modules/notifications/notification.service.js';
import { createEmailSender } from '../modules/notifications/senders.js';
import { SystemHealth } from '../modules/admin/system-health.js';
import { createPaymentProvider } from '../modules/payments/factory.js';
import { PaymentService } from '../modules/payments/payment.service.js';
import { PayoutService } from '../modules/payouts/payout.service.js';
import { SettingsService } from '../modules/settings/settings.service.js';
import { runSweep } from './sweeper.js';

export interface Sweeps {
  /** Stops the timer and resolves once any running sweep has finished. */
  stop(): Promise<void>;
}

/**
 * Runs the maintenance sweep every SWEEP_INTERVAL_SECONDS: hold expiry, completion,
 * upload cleanup, refunds, notification delivery and payouts. Used by the worker process,
 * and by the API itself when RUN_JOBS_IN_PROCESS is set (hosts without a free worker tier).
 * The sweep's advisory lock keeps any number of runners from overlapping.
 */
export function startSweeps(deps: {
  env: Env;
  logger: Logger;
  pool: pg.Pool;
  db: Db;
  storage: ObjectStorage;
}): Sweeps {
  const { env, logger, pool, db, storage } = deps;
  const settings = new SettingsService(db);
  const audit = new AuditService(db, logger);
  const bookingService = new BookingService(db, new QuoteService(db, settings), settings, audit);
  const payments = new PaymentService(db, createPaymentProvider(env), settings, audit, logger);
  const notifications = new NotificationService(
    db,
    createEmailSender(env, logger.child({ component: 'email' })),
    new InvoiceService(db),
    env.APP_BASE_URL,
    logger,
    env.ADMIN_NOTIFY_EMAIL,
  );
  const payouts = new PayoutService(db, settings);

  const intervalMs = env.SWEEP_INTERVAL_SECONDS * 1000;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (running) return;
    running = runSweep({
      pool,
      db,
      bookingService,
      storage,
      payments,
      notifications,
      payouts,
      logger,
    })
      .then(() => undefined)
      .catch((err: unknown) => logger.error({ err }, 'sweep failed'))
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  logger.info({ intervalMs }, 'sweeps started');

  // Hourly: email the admin if the SMTP key is about to expire or emails are failing.
  // Each alert claims its slot in the database, so several runners never send it twice.
  const health = new SystemHealth(db, {
    emailProvider: env.EMAIL_PROVIDER,
    smtpKeyExpiresAt: env.SMTP_KEY_EXPIRES_AT,
    adminEmail: env.ADMIN_NOTIFY_EMAIL,
    appBaseUrl: env.APP_BASE_URL,
  });
  const alertEmail = createEmailSender(env, logger.child({ component: 'alerts' }));
  const checkHealth = () =>
    void health
      .sendAlerts(alertEmail, logger)
      .then((sent) => sent.length && logger.info({ sent }, 'system alerts sent'))
      .catch((err: unknown) => logger.error({ err }, 'system health check failed'));
  const healthTimer = setInterval(checkHealth, 60 * 60_000);
  checkHealth();

  return {
    async stop() {
      clearInterval(timer);
      clearInterval(healthTimer);
      await running;
    },
  };
}
