import type { Request, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import {
  type RateLimiterAbstract,
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import { errors } from '../errors.js';

export interface LimitSpec {
  /** Allowed requests per window. */
  points: number;
  windowSeconds: number;
}

/** Central place for every limit, so they can be reviewed together. */
export const LIMITS = {
  apiPerIp: { points: 300, windowSeconds: 60 },
  apiPerUser: { points: 600, windowSeconds: 60 },
  loginPerIp: { points: 20, windowSeconds: 15 * 60 },
  loginPerEmail: { points: 10, windowSeconds: 15 * 60 },
  registerPerIp: { points: 10, windowSeconds: 60 * 60 },
  passwordResetPerIp: { points: 10, windowSeconds: 60 * 60 },
  passwordResetPerEmail: { points: 3, windowSeconds: 60 * 60 },
  otpSendPerUser: { points: 5, windowSeconds: 60 * 60 },
  otpSendPerPhone: { points: 5, windowSeconds: 60 * 60 },
  otpVerifyPerUser: { points: 10, windowSeconds: 15 * 60 },
  refreshPerIp: { points: 60, windowSeconds: 60 },
  // Holds lock a date for everyone else; cap how often one customer can do that.
  holdPerUser: { points: 6, windowSeconds: 60 * 60 },
  quotePerIp: { points: 120, windowSeconds: 60 },
  /** Reviews and owner replies (spam). */
  reviewWritePerUser: { points: 10, windowSeconds: 60 * 60 },
  /** CSV exports read up to 50,000 rows. */
  reportExportPerUser: { points: 20, windowSeconds: 60 * 60 },
  /** Invoice PDFs are rendered on request. */
  invoicePerUser: { points: 60, windowSeconds: 60 * 60 },
} satisfies Record<string, LimitSpec>;

export type LimitName = keyof typeof LIMITS;

export class RateLimiters {
  private readonly limiters = new Map<LimitName, RateLimiterAbstract>();

  /** With Redis, limits are shared across instances; a memory limiter covers Redis outages. */
  constructor(redis: Redis | null, overrides: Partial<Record<LimitName, LimitSpec>> = {}) {
    for (const name of Object.keys(LIMITS) as LimitName[]) {
      const spec = overrides[name] ?? LIMITS[name];
      const opts = { keyPrefix: `rl:${name}`, points: spec.points, duration: spec.windowSeconds };
      this.limiters.set(
        name,
        redis
          ? new RateLimiterRedis({
              ...opts,
              storeClient: redis,
              insuranceLimiter: new RateLimiterMemory(opts),
            })
          : new RateLimiterMemory(opts),
      );
    }
  }

  /** Consumes one point; throws a 429 HttpError when the limit is exhausted. */
  async consume(name: LimitName, key: string): Promise<void> {
    const limiter = this.limiters.get(name);
    if (!limiter) throw new Error(`unknown limiter ${name}`);
    try {
      await limiter.consume(key);
    } catch (err) {
      if (err instanceof RateLimiterRes) throw errors.tooManyRequests(err.msBeforeNext / 1000);
      throw err;
    }
  }

  async reset(name: LimitName, key: string): Promise<void> {
    await this.limiters.get(name)?.delete(key);
  }

  middleware(name: LimitName, keyOf: (req: Request) => string | undefined): RequestHandler {
    return (req, _res, next) => {
      const key = keyOf(req);
      if (!key) return next();
      this.consume(name, key).then(() => next(), next);
    };
  }
}

export const byIp = (req: Request) => req.ip ?? 'unknown';
