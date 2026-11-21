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
import { AccessTokenService } from './modules/auth/access-tokens.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { type BreachChecker, HibpBreachChecker, noBreachCheck } from './modules/auth/password.js';
import { RefreshTokenService } from './modules/auth/refresh-tokens.js';
import type { EmailSender, SmsSender } from './modules/notifications/senders.js';
import { ownerRouter } from './modules/owners/owner.routes.js';
import { createAuthenticate } from './modules/rbac/authenticate.js';

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
  breaches?: BreachChecker;
  limitOverrides?: Partial<Record<LimitName, LimitSpec>>;
}

export interface Container {
  api: Router;
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
  api.use('/auth', authRouter({ auth, limiters, authenticate, csrf }));
  api.use(
    '/owner',
    limiters.middleware('apiPerUser', byIp),
    ownerRouter({ db, authenticate, audit, auth, crypto, storage: deps.storage }),
  );
  api.use('/admin', adminRouter({ db, auth, audit, authenticate }));

  return { api, auth, audit, accessTokens, refreshTokens, limiters, authenticate };
}
