import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Env } from '../config/env.js';
import { clientIp } from './middleware/client-ip.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { healthRouter, type ReadinessCheck } from './routes/health.js';

export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGINS' | 'BODY_LIMIT' | 'TRUST_PROXY_HOPS'> &
    Partial<Pick<Env, 'CLIENT_IP_HEADER' | 'PROXY_SHARED_SECRET'>>;
  logger: Logger;
  readinessChecks: Record<string, ReadinessCheck>;
  /** Versioned API routes, mounted at /api/v1. */
  api?: Router;
}

export function createApp({ env, logger, readinessChecks, api }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(requestId);
  // Before anything reads req.ip (rate limits, audit context, request logs).
  app.use(clientIp({ edgeHeader: env.CLIENT_IP_HEADER, proxySecret: env.PROXY_SHARED_SECRET }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      // The resolved client IP, so the logs show what rate limits are keyed by.
      customProps: (req) => ({ clientIp: (req as express.Request).ip }),
      customLogLevel: (req, res, err) => {
        // A failing readiness probe is an expected state, already logged per check.
        if (req.url === '/ready') return res.statusCode >= 500 ? 'warn' : 'silent';
        if (err || res.statusCode >= 500) return 'error';
        return res.statusCode >= 400 ? 'warn' : 'info';
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  // The API serves JSON only, so the CSP can be maximally strict.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      frameguard: { action: 'deny' },
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );

  const allowed = new Set(env.CORS_ORIGINS);
  app.use(
    cors({
      // Requests without an Origin header (same-origin, curl, server-to-server) are not CORS.
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-CSRF-Token',
        'X-Request-Id',
        'Idempotency-Key',
      ],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  // Payment webhooks are verified over the exact bytes received, so keep them raw.
  app.use('/api/v1/payments/webhooks', express.raw({ type: () => true, limit: '256kb' }));
  app.use(express.json({ limit: env.BODY_LIMIT, strict: true }));
  app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));
  app.use(cookieParser());

  app.use(healthRouter(readinessChecks));

  app.use('/api/v1', api ?? express.Router());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
