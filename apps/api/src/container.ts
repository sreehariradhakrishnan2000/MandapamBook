import { createHmac } from 'node:crypto';
import { type RequestHandler, Router } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import type { Db } from './db/client.js';
import { createCsrf } from './http/middleware/csrf.js';
import {
  type LimitName,
  type LimitSpec,
  RateLimiters,
  byIp,
} from './http/middleware/rate-limit.js';
import type { RevocationStore } from './infra/revocation-store.js';
import type { ObjectStorage } from './infra/storage.js';
import { FieldCrypto } from './lib/field-crypto.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { AuditService } from './modules/audit/audit.service.js';
import { BookingService } from './modules/bookings/booking.service.js';
import { bookingsRouter } from './modules/bookings/bookings.routes.js';
import { QuoteService } from './modules/bookings/quote.service.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { AccessTokenService } from './modules/auth/access-tokens.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { GoogleOAuth, type GoogleProvider } from './modules/auth/google.js';
import { AuthService } from './modules/auth/auth.service.js';
import { type BreachChecker, HibpBreachChecker, noBreachCheck } from './modules/auth/password.js';
import { RefreshTokenService } from './modules/auth/refresh-tokens.js';
import {
  BackgroundEmailSender,
  type EmailSender,
  type SmsSender,
} from './modules/notifications/senders.js';
import { ownerRouter } from './modules/owners/owner.routes.js';
import { createAuthenticate } from './modules/rbac/authenticate.js';
import {
  type PaymentEnv,
  createPaymentProvider,
  providerRoutes,
} from './modules/payments/factory.js';
import { PaymentService } from './modules/payments/payment.service.js';
import { InvoiceService } from './modules/invoices/invoice.service.js';
import { reviewsRouter } from './modules/reviews/reviews.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { ScopedResources } from './modules/owners/scoped.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import type { PaymentProvider } from './modules/payments/provider.js';
import { SettingsService } from './modules/settings/settings.service.js';
import { SystemHealth } from './modules/admin/system-health.js';
import { seoRouter } from './modules/catalog/seo.routes.js';
import {
  bookingsPauseGate,
  createBookingsPauseService,
  createMaintenanceService,
  maintenanceGate,
  siteStatusRouter,
} from './modules/settings/maintenance.js';

export type AuthEnv = Pick<
  Env,
  | 'CORS_ORIGINS'
  | 'APP_BASE_URL'
  | 'ACCESS_TOKEN_KEYS'
  | 'REFRESH_TOKEN_KEYS'
  | 'CSRF_SECRET'
  | 'OTP_SECRET'
  | 'ACCESS_TOKEN_TTL_SECONDS'
  | 'REFRESH_TOKEN_TTL_DAYS'
  | 'REFRESH_TOKEN_REMEMBER_DAYS'
  | 'LOGIN_MAX_FAILURES'
  | 'LOGIN_LOCKOUT_MINUTES'
  | 'HIBP_ENABLED'
  | 'FIELD_ENCRYPTION_KEYS'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
> &
  PaymentEnv &
  // Operational settings, optional so tests need not set them.
  Partial<
    Pick<
      Env,
      | 'EMAIL_PROVIDER'
      | 'SMTP_KEY_EXPIRES_AT'
      | 'ADMIN_NOTIFY_EMAIL'
      | 'SENTRY_DSN'
      | 'SENTRY_WEB_DSN'
      | 'APP_ENV'
    >
  >;

export interface ContainerDeps {
  env: AuthEnv;
  logger: Logger;
  db: Db;
  redis: Redis | null;
  revocations: RevocationStore;
  email: EmailSender;
  sms: SmsSender;
  storage: ObjectStorage;
  /** Tests inject a provider with known secrets; otherwise it is built from env. */
  paymentProvider?: PaymentProvider;
  /** Tests inject a fake Google; otherwise it is built from GOOGLE_CLIENT_ID/SECRET. */
  googleProvider?: GoogleProvider;
  breaches?: BreachChecker;
  limitOverrides?: Partial<Record<LimitName, LimitSpec>>;
}

export interface Container {
  api: Router;
  bookings: BookingService;
  payments: PaymentService;
  invoices: InvoiceService;
  auth: AuthService;
  audit: AuditService;
  accessTokens: AccessTokenService;
  refreshTokens: RefreshTokenService;
  limiters: RateLimiters;
  authenticate: RequestHandler;
  /** Emails sent while handling requests; drain it before shutting down. */
  directEmail: BackgroundEmailSender;
}

/** Composition root: the only place concrete implementations are chosen. */
export function buildContainer(deps: ContainerDeps): Container {
  const { env, db } = deps;
  const accessTokens = new AccessTokenService(env.ACCESS_TOKEN_KEYS, env.ACCESS_TOKEN_TTL_SECONDS);
  const refreshTokens = new RefreshTokenService(env.REFRESH_TOKEN_KEYS);
  const limiters = new RateLimiters(deps.redis, deps.limitOverrides);
  const audit = new AuditService(db, deps.logger);
  // Requests never wait on, or fail because of, the mail server. Booking emails use the outbox.
  const directEmail = new BackgroundEmailSender(deps.email, deps.logger);
  const breaches = deps.breaches ?? (env.HIBP_ENABLED ? new HibpBreachChecker() : noBreachCheck);
  const auth = new AuthService(
    db,
    {
      appBaseUrl: env.APP_BASE_URL,
      refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      refreshRememberDays: env.REFRESH_TOKEN_REMEMBER_DAYS,
      maxFailures: env.LOGIN_MAX_FAILURES,
      lockoutMinutes: env.LOGIN_LOCKOUT_MINUTES,
      otpSecret: env.OTP_SECRET,
    },
    accessTokens,
    refreshTokens,
    deps.revocations,
    limiters,
    audit,
    directEmail,
    deps.sms,
    breaches,
  );
  const authenticate = createAuthenticate(accessTokens, deps.revocations);
  const csrf = createCsrf(env.CSRF_SECRET, env.CORS_ORIGINS);
  const crypto = new FieldCrypto(env.FIELD_ENCRYPTION_KEYS);

  const api = Router();
  api.use(limiters.middleware('apiPerIp', byIp));
  // Site switches: the status and admin routes come first, then the gates. Maintenance
  // closes the site; a bookings pause only refuses new holds and payments.
  const maintenance = createMaintenanceService(db);
  const bookingsPause = createBookingsPauseService(db);
  api.use(
    siteStatusRouter({
      maintenance,
      bookingsPause,
      audit,
      authenticate,
      webErrorTracking: {
        dsn: env.SENTRY_WEB_DSN ?? null,
        environment: env.APP_ENV ?? 'development',
      },
    }),
  );
  api.use(maintenanceGate(maintenance, accessTokens, deps.revocations));
  api.use(bookingsPauseGate(bookingsPause));
  const settings = new SettingsService(db);
  const quotes = new QuoteService(db, settings);
  const bookingService = new BookingService(db, quotes, settings, audit);
  const provider = deps.paymentProvider ?? createPaymentProvider(env);
  const paymentService = new PaymentService(db, provider, settings, audit, deps.logger);
  const invoices = new InvoiceService(db);
  api.use(catalogRouter({ db, storage: deps.storage }));
  api.use(seoRouter({ db, storage: deps.storage, appBaseUrl: env.APP_BASE_URL }));
  api.use(
    bookingsRouter({
      db,
      quotes,
      bookings: bookingService,
      payments: paymentService,
      invoices,
      limiters,
      authenticate,
    }),
  );
  // Provider-hosted pages (the mock checkout) are public, so they mount before the
  // authenticated /payments routes.
  const extra = providerRoutes(provider, {
    db,
    payments: paymentService,
    appBaseUrl: env.APP_BASE_URL,
    logger: deps.logger,
  });
  if (extra) api.use(extra);
  api.use(paymentsRouter({ payments: paymentService, authenticate, limiters }));
  // Reviews span public, customer, owner and admin paths, each with its own permission.
  const scoped = new ScopedResources(db);
  api.use(reviewsRouter({ db, authenticate, scoped, audit, limiters }));
  api.use(reportsRouter({ db, authenticate, scoped, audit, limiters }));
  const googleProvider =
    deps.googleProvider ??
    (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? new GoogleOAuth(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)
      : undefined);
  api.use(
    '/auth',
    authRouter({
      auth,
      limiters,
      authenticate,
      csrf,
      appBaseUrl: env.APP_BASE_URL,
      ...(googleProvider
        ? {
            google: {
              provider: googleProvider,
              // A key of its own, derived so no new secret has to be managed.
              stateKey: createHmac('sha256', env.CSRF_SECRET).update('google-oauth-state').digest(),
            },
          }
        : {}),
    }),
  );
  api.use(
    '/owner',
    limiters.middleware('apiPerUser', byIp),
    ownerRouter({
      db,
      authenticate,
      audit,
      auth,
      crypto,
      storage: deps.storage,
      payments: paymentService,
      invoices,
    }),
  );
  api.use(
    '/admin',
    adminRouter({
      db,
      auth,
      audit,
      authenticate,
      storage: deps.storage,
      crypto,
      email: directEmail,
      settings,
      payments: paymentService,
      appBaseUrl: env.APP_BASE_URL,
      health: new SystemHealth(db, {
        emailProvider: env.EMAIL_PROVIDER ?? 'console',
        smtpKeyExpiresAt: env.SMTP_KEY_EXPIRES_AT,
        adminEmail: env.ADMIN_NOTIFY_EMAIL,
        appBaseUrl: env.APP_BASE_URL,
      }),
      errorTracking: { api: Boolean(env.SENTRY_DSN), web: Boolean(env.SENTRY_WEB_DSN) },
    }),
  );

  return {
    api,
    bookings: bookingService,
    payments: paymentService,
    invoices,
    auth,
    audit,
    accessTokens,
    refreshTokens,
    limiters,
    authenticate,
    directEmail,
  };
}
