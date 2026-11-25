import { z } from 'zod';

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

export interface KeyRingEntry {
  kid: string;
  secret: Buffer;
}

/**
 * A key ring: "kid1:base64url,kid0:base64url". The first key signs; every key verifies,
 * so a new key can be prepended and the old one removed once its tokens have expired.
 * Each secret must be at least 32 bytes.
 */
const keyRing = csv.transform((entries, ctx): KeyRingEntry[] => {
  const ring: KeyRingEntry[] = [];
  for (const entry of entries) {
    const [kid, encoded] = entry.split(':');
    if (!kid || !encoded || !/^[A-Za-z0-9_-]{1,32}$/.test(kid)) {
      ctx.addIssue({ code: 'custom', message: 'each entry must be <kid>:<base64url secret>' });
      return z.NEVER;
    }
    const secret = Buffer.from(encoded, 'base64url');
    if (secret.length < 32) {
      ctx.addIssue({ code: 'custom', message: `key "${kid}" must be at least 32 bytes` });
      return z.NEVER;
    }
    if (ring.some((k) => k.kid === kid)) {
      ctx.addIssue({ code: 'custom', message: `duplicate kid "${kid}"` });
      return z.NEVER;
    }
    ring.push({ kid, secret });
  }
  if (ring.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'at least one key is required' });
    return z.NEVER;
  }
  return ring;
});

/** An optional setting where an empty value (e.g. `GOOGLE_CLIENT_ID=` in .env) means "not set". */
const blankIsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const secret32 = z
  .string()
  .transform((v) => Buffer.from(v, 'base64url'))
  .refine((b) => b.length >= 32, 'must be at least 32 bytes (base64url)');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Which deployment this is, when NODE_ENV=production. "staging" keeps every production
   * safeguard but allows the mock payment gateway (shown with the TEST MODE banner) and
   * Razorpay test keys. Unset means "production", the strict default, so forgetting it can
   * never loosen production.
   */
  APP_ENV: z.enum(['staging', 'production']).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of trusted reverse-proxy hops in front of the API (affects req.ip). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Header in which the hosting edge puts the real client IP, overwriting any client value
   * (Render/Cloudflare: cf-connecting-ip). When set, it is used instead of counting
   * X-Forwarded-For hops. Only set it behind an edge that guarantees that header.
   */
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/, 'a header name')
    .optional(),
  /**
   * Shared with the web app's nginx: proves that x-mb-client-ip came from our own proxy.
   * At least 32 base64url characters (node scripts/generate-secrets.mjs).
   */
  PROXY_SHARED_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,}$/, 'at least 32 base64url characters')
    .optional(),
  /** Comma-separated exact origins allowed by CORS. No wildcards. */
  CORS_ORIGINS: csv.pipe(z.array(z.url()).min(1)),
  /** Public URL of the web app, used in email links. */
  APP_BASE_URL: z.url().default('http://localhost:4200'),
  DATABASE_URL: z.url().refine((u) => u.startsWith('postgres'), 'must be a postgres:// URL'),
  REDIS_URL: z.url().refine((u) => /^rediss?:\/\//.test(u), 'must be a redis:// or rediss:// URL'),
  /** Namespace for every Redis key (rate limits, revocations), e.g. "e2e:run1:". Default: none. */
  REDIS_KEY_PREFIX: z
    .string()
    .max(40)
    .regex(/^[a-z0-9:_-]*$/, 'lowercase letters, digits, : _ - only')
    .default(''),
  /** JSON request body limit, e.g. "100kb". */
  BODY_LIMIT: z
    .string()
    .regex(/^\d+(kb|mb)$/)
    .default('100kb'),
  ENABLE_API_DOCS: booleanString.default(false),
  /** Seconds between maintenance sweeps (worker, or the API with RUN_JOBS_IN_PROCESS). */
  SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  /**
   * Run the maintenance sweeps inside the API process instead of a separate worker. For
   * hosts without a free worker tier. Safe alongside workers: the sweep takes an advisory
   * lock, so only one process sweeps at a time.
   */
  RUN_JOBS_IN_PROCESS: booleanString.default(false),

  // --- Auth ---
  /** HS256 signing keys for access tokens. Separate from the refresh-token keys. */
  ACCESS_TOKEN_KEYS: keyRing,
  /** HMAC keys for hashing refresh tokens at rest. Separate from the access-token keys. */
  REFRESH_TOKEN_KEYS: keyRing,
  /** HMAC key for signed double-submit CSRF tokens. */
  CSRF_SECRET: secret32,
  /** HMAC key for email tokens and OTP codes at rest. */
  OTP_SECRET: secret32,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  REFRESH_TOKEN_REMEMBER_DAYS: z.coerce.number().int().min(1).max(30).default(30),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Check new passwords against Have I Been Pwned (k-anonymity; only a hash prefix is sent). */
  HIBP_ENABLED: booleanString.default(false),
  /**
   * "Continue with Google" (OAuth web client from Google Cloud Console). Set both to enable;
   * the authorised redirect URI is APP_BASE_URL + /api/v1/auth/google/callback.
   */
  GOOGLE_CLIENT_ID: blankIsUnset(
    z
      .string()
      .regex(
        /^[\w-]+\.apps\.googleusercontent\.com$/,
        'an OAuth client id ending .apps.googleusercontent.com',
      ),
  ),
  GOOGLE_CLIENT_SECRET: blankIsUnset(z.string().min(10)),
  /** console: log (dev). file: one JSON file per message in EMAIL_FILE_DIR (e2e tests). smtp: real delivery. */
  EMAIL_PROVIDER: z.enum(['console', 'file', 'smtp']).default('console'),
  EMAIL_FILE_DIR: z.string().min(1).optional(),
  OTP_PROVIDER: z.enum(['console']).default('console'),
  /** e.g. smtp://localhost:1025 (Mailpit) or smtps://user:pass@relay:465. Required for EMAIL_PROVIDER=smtp. */
  SMTP_URL: z
    .url()
    .refine(
      (u) => u.startsWith('smtp://') || u.startsWith('smtps://'),
      'must be smtp:// or smtps://',
    )
    .optional(),
  EMAIL_FROM: z.string().min(3).default('MandapamBook <no-reply@mandapambook.example>'),

  // --- Data protection ---
  /** AES-256-GCM keys for PAN and bank details ("kid:base64url", exactly 32 bytes each). */
  FIELD_ENCRYPTION_KEYS: keyRing,

  // --- Object storage (S3-compatible) ---
  STORAGE_PROVIDER: z.enum(['s3', 'memory']).default('s3'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3).default('mandapambook-media'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanString.default(true),

  // --- Payments ---
  /** Which gateway to use. Switching gateways is only this change plus its credentials. */
  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  /** Mock gateway: signs checkout results (like a gateway key secret). */
  MOCK_PAYMENT_KEY_SECRET: secret32.optional(),
  /** Mock gateway: signs webhooks. Separate from the key secret, as real gateways do. */
  MOCK_PAYMENT_WEBHOOK_SECRET: secret32.optional(),
  RAZORPAY_KEY_ID: z
    .string()
    .regex(/^rzp_(test|live)_[A-Za-z0-9]+$/)
    .optional(),
  RAZORPAY_KEY_SECRET: z.string().min(16).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  override name = 'EnvValidationError';
}

/**
 * Parse and validate environment variables. Throws with a readable list of
 * problems (field names and rules only, never the values, which may be secrets).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new EnvValidationError(`Invalid environment configuration:\n${problems}`);
  }
  const env = result.data;
  const problems: string[] = [];
  if (env.APP_ENV && env.NODE_ENV !== 'production') {
    problems.push('APP_ENV: only meaningful with NODE_ENV=production');
  }
  const staging = env.APP_ENV === 'staging';
  if (env.NODE_ENV === 'production') {
    if (env.CORS_ORIGINS.some((o) => o.startsWith('http://'))) {
      problems.push('CORS_ORIGINS: production origins must use https');
    }
    if (env.APP_BASE_URL.startsWith('http://')) problems.push('APP_BASE_URL: must use https');
    // Staging may use a host's private-network Redis (e.g. Render Key Value's internal
    // redis:// URL), which never leaves that network. Real production requires TLS.
    if (!staging && !env.REDIS_URL.startsWith('rediss://'))
      problems.push('REDIS_URL: production requires TLS (rediss://)');
    if (env.EMAIL_PROVIDER !== 'smtp')
      problems.push(`EMAIL_PROVIDER: ${env.EMAIL_PROVIDER} is not allowed in production`);
    if (env.STORAGE_PROVIDER === 'memory')
      problems.push('STORAGE_PROVIDER: memory is not allowed in production');
    // Staging may take test payments; real production may not.
    if (!staging && env.PAYMENT_PROVIDER === 'mock')
      problems.push('PAYMENT_PROVIDER: the mock gateway is not allowed in production');
    if (!staging && env.RAZORPAY_KEY_ID?.startsWith('rzp_test_'))
      problems.push('RAZORPAY_KEY_ID: test keys are not allowed in production');
    if (staging && env.RAZORPAY_KEY_ID?.startsWith('rzp_live_'))
      problems.push('RAZORPAY_KEY_ID: live keys are not allowed in staging');
  }
  if (
    env.PAYMENT_PROVIDER === 'mock' &&
    (!env.MOCK_PAYMENT_KEY_SECRET || !env.MOCK_PAYMENT_WEBHOOK_SECRET)
  ) {
    problems.push(
      'MOCK_PAYMENT_KEY_SECRET / MOCK_PAYMENT_WEBHOOK_SECRET: required when PAYMENT_PROVIDER=mock',
    );
  }
  if (
    env.PAYMENT_PROVIDER === 'razorpay' &&
    (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)
  ) {
    problems.push(
      'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET: required when PAYMENT_PROVIDER=razorpay',
    );
  }
  if (!env.GOOGLE_CLIENT_ID !== !env.GOOGLE_CLIENT_SECRET) {
    problems.push(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: set both to enable Google sign-in, or neither',
    );
  }
  if (env.EMAIL_PROVIDER === 'file' && !env.EMAIL_FILE_DIR) {
    problems.push('EMAIL_FILE_DIR: required when EMAIL_PROVIDER=file');
  }
  if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) {
    problems.push('SMTP_URL: required when EMAIL_PROVIDER=smtp');
  }
  if (env.STORAGE_PROVIDER === 's3' && (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
    problems.push('S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY: required when STORAGE_PROVIDER=s3');
  }
  if (env.FIELD_ENCRYPTION_KEYS.some((k) => k.secret.length !== 32)) {
    problems.push('FIELD_ENCRYPTION_KEYS: each key must be exactly 32 bytes (AES-256)');
  }
  const accessSecrets = new Set(env.ACCESS_TOKEN_KEYS.map((k) => k.secret.toString('hex')));
  if (env.REFRESH_TOKEN_KEYS.some((k) => accessSecrets.has(k.secret.toString('hex')))) {
    problems.push('REFRESH_TOKEN_KEYS: must not reuse an access-token key');
  }
  if (problems.length > 0) {
    throw new EnvValidationError(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return env;
}
