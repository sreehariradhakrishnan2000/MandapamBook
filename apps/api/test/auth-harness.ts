import { randomBytes, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { Redis } from 'ioredis';
import type pg from 'pg';
import request from 'supertest';
import type { Role } from '@mandapambook/shared';
import type { AuthEnv, Container } from '../src/container.js';
import { buildContainer } from '../src/container.js';
import type { Db } from '../src/db/client.js';
import { ownerProfiles, users } from '../src/db/schema/index.js';
import { createApp } from '../src/http/app.js';
import type { LimitName, LimitSpec } from '../src/http/middleware/rate-limit.js';
import {
  MemoryRevocationStore,
  RedisRevocationStore,
  type RevocationStore,
} from '../src/infra/revocation-store.js';
import { MemoryObjectStorage } from '../src/infra/storage.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { MemoryEmailSender, MemorySmsSender } from '../src/modules/notifications/senders.js';
import { createTestPool, testDb } from './db-helpers.js';
import { silentLogger } from './helpers.js';

export const ORIGIN = 'http://localhost:4200';
export const PASSWORD = 'correct horse battery staple';

const key = () => randomBytes(32).toString('base64url');

export function testAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    CORS_ORIGINS: [ORIGIN],
    APP_BASE_URL: ORIGIN,
    ACCESS_TOKEN_KEYS: [{ kid: 'a1', secret: Buffer.from(key(), 'base64url') }],
    REFRESH_TOKEN_KEYS: [{ kid: 'r1', secret: Buffer.from(key(), 'base64url') }],
    CSRF_SECRET: Buffer.from(key(), 'base64url'),
    OTP_SECRET: Buffer.from(key(), 'base64url'),
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_DAYS: 7,
    REFRESH_TOKEN_REMEMBER_DAYS: 30,
    LOGIN_MAX_FAILURES: 5,
    LOGIN_LOCKOUT_MINUTES: 15,
    HIBP_ENABLED: false,
    FIELD_ENCRYPTION_KEYS: [{ kid: 'f1', secret: randomBytes(32) }],
    ...overrides,
  };
}

export interface Harness {
  app: Express;
  db: Db;
  pool: pg.Pool;
  container: Container;
  email: MemoryEmailSender;
  sms: MemorySmsSender;
  revocations: RevocationStore;
  storage: MemoryObjectStorage;
  close(): Promise<void>;
}

/**
 * Full API wired to the test database. Uses real Redis when TEST_REDIS_URL is set
 * (CI, or Upstash locally); otherwise the in-memory stores with identical semantics.
 */
export async function createHarness(
  opts: { limitOverrides?: Partial<Record<LimitName, LimitSpec>>; env?: Partial<AuthEnv> } = {},
): Promise<Harness> {
  const pool = createTestPool(10);
  const db = testDb(pool);
  const email = new MemoryEmailSender();
  const sms = new MemorySmsSender();
  const storage = new MemoryObjectStorage();
  const redisUrl = process.env.TEST_REDIS_URL;
  const redis = redisUrl
    ? new Redis(redisUrl, {
        maxRetriesPerRequest: 2,
        keyPrefix: `test:${randomUUID().slice(0, 8)}:`,
      })
    : null;
  const revocations = redis ? new RedisRevocationStore(redis) : new MemoryRevocationStore();
  const env = testAuthEnv(opts.env);
  // Every test request comes from one IP, so per-IP limits are raised unless a test
  // sets them explicitly (see rate-limit.test.ts). Per-account limits keep real values.
  const generous = { points: 10_000, windowSeconds: 60 };
  const container = buildContainer({
    env,
    logger: silentLogger,
    db,
    redis,
    revocations,
    email,
    sms,
    storage,
    limitOverrides: {
      apiPerIp: generous,
      loginPerIp: generous,
      registerPerIp: generous,
      passwordResetPerIp: generous,
      refreshPerIp: generous,
      ...opts.limitOverrides,
    },
  });
  const app = createApp({
    env: { CORS_ORIGINS: env.CORS_ORIGINS, BODY_LIMIT: '100kb', TRUST_PROXY_HOPS: 0 },
    logger: silentLogger,
    readinessChecks: {},
    api: container.api,
  });
  return {
    app,
    db,
    pool,
    container,
    email,
    sms,
    revocations,
    storage,
    close: async () => {
      await pool.end();
      await redis?.quit();
    },
  };
}

export const uniqueEmail = (label = 'user') => `${label}-${randomUUID().slice(0, 8)}@example.test`;

/** Inserts an active, verified user with a known password. */
export async function createUser(
  db: Db,
  role: Role = 'CUSTOMER',
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<{ id: string; email: string }> {
  const email = overrides.email ?? uniqueEmail(role.toLowerCase());
  const [user] = await db
    .insert(users)
    .values({
      email,
      fullName: `${role} Test`,
      role,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(PASSWORD),
      ...overrides,
    })
    .returning({ id: users.id, email: users.email });
  if (!user) throw new Error('createUser failed');
  if (role === 'OWNER')
    await db.insert(ownerProfiles).values({ userId: user.id, businessName: email });
  return user;
}

/** Cookie jar that, unlike superagent's, sends Secure cookies over the test's plain HTTP. */
export class Client {
  readonly cookies = new Map<string, string>();
  accessToken: string | undefined;

  constructor(private readonly app: Express) {}

  private absorb(res: request.Response): void {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of raw ?? []) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async send(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
    opts: { csrf?: boolean; bearer?: string | null } = {},
  ): Promise<request.Response> {
    // Fetch the CSRF token first so its cookie is included below.
    const csrf = opts.csrf ? await this.csrfToken() : undefined;
    let req = request(this.app)[method](path).set('Origin', ORIGIN);
    if (this.cookies.size) req = req.set('Cookie', this.cookieHeader());
    const bearer = opts.bearer === undefined ? this.accessToken : opts.bearer;
    if (bearer) req = req.set('Authorization', `Bearer ${bearer}`);
    if (csrf) req = req.set('X-CSRF-Token', csrf);
    const res = await (body ? req.send(body) : req);
    this.absorb(res);
    return res;
  }

  async csrfToken(): Promise<string> {
    const existing = this.cookies.get('__Host-mb_csrf');
    if (existing) return existing;
    const res = await request(this.app).get('/api/v1/auth/csrf');
    this.absorb(res);
    return (res.body as { csrfToken: string }).csrfToken;
  }

  async login(email: string, password = PASSWORD): Promise<request.Response> {
    const res = await this.send('post', '/api/v1/auth/login', { email, password });
    if (res.status === 200) this.accessToken = (res.body as { accessToken: string }).accessToken;
    return res;
  }

  async refresh(): Promise<request.Response> {
    const res = await this.send('post', '/api/v1/auth/refresh', undefined, {
      csrf: true,
      bearer: null,
    });
    if (res.status === 200) this.accessToken = (res.body as { accessToken: string }).accessToken;
    return res;
  }

  get refreshCookie(): string | undefined {
    return this.cookies.get('__Host-mb_rt');
  }
}

/** Extracts the token query parameter from the last email sent to `to`. */
export function tokenFromEmail(email: MemoryEmailSender, to: string): string {
  const msg = email.lastTo(to);
  const token = msg ? /token=([A-Za-z0-9_-]+)/.exec(msg.text)?.[1] : undefined;
  if (!token) throw new Error(`no token email for ${to}`);
  return token;
}
