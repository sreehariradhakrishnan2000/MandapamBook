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
import { AuthService } from './modules/auth/auth.service.js';
import { type BreachChecker, HibpBreachChecker, noBreachCheck } from './modules/auth/password.js';
import { RefreshTokenService } from './modules/auth/refresh-tokens.js';
import type { EmailSender, SmsSender } from './modules/notifications/senders.js';
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
> &
  PaymentEnv;

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
}

/** Composition root: the only place concrete implementations are chosen. */
export function buildContainer(deps: ContainerDeps): Container {
  const { env, db } = deps;
  const accessTokens = new AccessTokenService(env.ACCESS_TOKEN_KEYS, env.ACCESS_TOKEN_TTL_SECONDS);
  const refreshTokens = new RefreshTokenService(env.REFRESH_TOKEN_KEYS);
  const limiters = new RateLimiters(deps.redis, deps.limitOverrides);
  const audit = new AuditService(db, deps.logger);
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
    deps.email,
    deps.sms,
    breaches,
  );
  const authenticate = createAuthenticate(accessTokens, deps.revocations);
  const csrf = createCsrf(env.CSRF_SECRET, env.CORS_ORIGINS);
  const crypto = new FieldCrypto(env.FIELD_ENCRYPTION_KEYS);

  const api = Router();
  api.use(limiters.middleware('apiPerIp', byIp));
  const settings = new SettingsService(db);
  const quotes = new QuoteService(db, settings);
  const bookingService = new BookingService(db, quotes, settings, audit);
  const provider = deps.paymentProvider ?? createPaymentProvider(env);
  const paymentService = new PaymentService(db, provider, settings, audit, deps.logger);
  const invoices = new InvoiceService(db);
  api.use(catalogRouter({ db, storage: deps.storage }));
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
  api.use(reviewsRouter({ db, authenticate, scoped, audit }));
  api.use(reportsRouter({ db, authenticate, scoped, audit }));
  api.use('/auth', authRouter({ auth, limiters, authenticate, csrf }));
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
      email: deps.email,
      settings,
      payments: paymentService,
      appBaseUrl: env.APP_BASE_URL,
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
  };
}
