import { z } from 'zod';

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of trusted reverse-proxy hops in front of the API (affects req.ip). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Comma-separated exact origins allowed by CORS. No wildcards. */
  CORS_ORIGINS: csv.pipe(z.array(z.url()).min(1)),
  DATABASE_URL: z.url().refine((u) => u.startsWith('postgres'), 'must be a postgres:// URL'),
  REDIS_URL: z.url().refine((u) => u.startsWith('redis'), 'must be a redis:// URL'),
  /** JSON request body limit, e.g. "100kb". */
  BODY_LIMIT: z
    .string()
    .regex(/^\d+(kb|mb)$/)
    .default('100kb'),
  ENABLE_API_DOCS: booleanString.default(false),
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
  if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.some((o) => o.startsWith('http://'))) {
    throw new EnvValidationError(
      'Invalid environment configuration:\n  - CORS_ORIGINS: production origins must use https',
    );
  }
  return env;
}
