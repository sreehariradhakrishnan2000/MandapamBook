import {
  type BookingsPause,
  type Maintenance,
  bookingsPauseSchema,
  maintenanceSchema,
  maintenanceUpdateSchema,
} from '@mandapambook/shared';
import { eq } from 'drizzle-orm';
import { type RequestHandler, Router } from 'express';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import { platformSettings } from '../../db/schema/index.js';
import { HttpError } from '../../http/errors.js';
import type { RevocationStore } from '../../infra/revocation-store.js';
import { type AuditAction, type AuditService, auditContext } from '../audit/audit.service.js';
import type { AccessTokenService } from '../auth/access-tokens.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';

/** How long a read is reused. A change reaches every instance within this. */
const CACHE_MS = 5_000;

/**
 * One switch stored as a row in platform_settings (no migration needed), read through a
 * short cache because the gates below run on every request.
 */
export class SettingStore<T> {
  private cached: { value: T; at: number } | null = null;

  constructor(
    private readonly db: Db,
    readonly key: string,
    private readonly schema: z.ZodType<T>,
    private readonly fallback: T,
  ) {}

  async get(): Promise<T> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const [row] = await this.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, this.key));
    const parsed = this.schema.safeParse(row?.value);
    const value = parsed.success ? parsed.data : this.fallback;
    this.cached = { value, at: Date.now() };
    return value;
  }

  async set(value: T, actorId: string): Promise<{ before: T; after: T }> {
    const before = await this.get();
    await this.db
      .insert(platformSettings)
      .values({ key: this.key, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: actorId } });
    this.cached = { value, at: Date.now() };
    return { before, after: value };
  }
}

export type MaintenanceService = SettingStore<Maintenance>;
export type BookingsPauseService = SettingStore<BookingsPause>;

export const MAINTENANCE_OFF: Maintenance = {
  enabled: false,
  message: '',
  until: null,
  scheduledFrom: null,
  scheduledTo: null,
};

export function createMaintenanceService(db: Db): MaintenanceService {
  return new SettingStore(db, 'maintenance', maintenanceSchema, MAINTENANCE_OFF);
}

export function createBookingsPauseService(db: Db): BookingsPauseService {
  return new SettingStore(db, 'bookings_pause', bookingsPauseSchema, {
    paused: false,
    message: '',
  });
}

/**
 * Paths that keep working during maintenance: the status the maintenance page polls,
 * sign-in (so staff can get in) and payment webhooks (money that moved must be recorded).
 */
const ALWAYS_OPEN = [/^\/status$/, /^\/auth\//, /^\/payments\/webhooks\//, /^\/seo\//];
const STAFF_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

/**
 * True only for a valid, unrevoked admin access token: the same checks `authenticate`
 * makes (signature, expiry, logout, session and user-wide revocation). Anything else,
 * including no header at all, is treated as a visitor.
 */
async function isActiveStaff(
  authorization: string | undefined,
  tokens: AccessTokenService,
  revocations: RevocationStore,
): Promise<boolean> {
  const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization ?? '')?.[1] ?? '';
  const claims = await tokens.verify(token).catch(() => null);
  if (!claims || !STAFF_ROLES.has(claims.role)) return false;
  const [tokenRevoked, familyRevoked, cutoff] = await Promise.all([
    revocations.isTokenRevoked(claims.jti),
    revocations.isFamilyRevoked(claims.familyId),
    revocations.getUserCutoff(claims.userId),
  ]);
  return !tokenRevoked && !familyRevoked && (cutoff === null || claims.issuedAtMs > cutoff);
}

/**
 * While maintenance is on, answers everyone except admins with 503 MAINTENANCE. The web
 * app turns that into the maintenance page. Admin routes still run their own full
 * authentication; this only decides who gets past the "closed" sign.
 */
export function maintenanceGate(
  maintenance: MaintenanceService,
  tokens: AccessTokenService,
  revocations: RevocationStore,
): RequestHandler {
  return (req, _res, next) => {
    if (ALWAYS_OPEN.some((p) => p.test(req.path))) return next();
    maintenance
      .get()
      .then(async (m) => {
        if (!m.enabled) return next();
        if (await isActiveStaff(req.get('authorization'), tokens, revocations)) return next();
        const retryAfter = m.until
          ? Math.max(60, Math.round((Date.parse(m.until) - Date.now()) / 1000))
          : 300;
        next(
          new HttpError(
            503,
            'MAINTENANCE',
            m.message || 'MandapamBook is down for planned maintenance. Please check back soon.',
            { until: m.until },
            { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
          ),
        );
      })
      .catch(next);
  };
}

/** The requests that start a booking or a payment. Everything else keeps working. */
const BOOKING_STARTS = [/^\/bookings$/, /^\/payments\/orders$/];

/**
 * While bookings are paused, refuses new holds and new payment orders with 503
 * BOOKINGS_PAUSED. Browsing, cancelling, verifying payments already made and webhooks
 * keep working, so no money is left in limbo.
 */
export function bookingsPauseGate(pause: BookingsPauseService): RequestHandler {
  return (req, _res, next) => {
    if (req.method !== 'POST' || !BOOKING_STARTS.some((p) => p.test(req.path))) return next();
    pause
      .get()
      .then((p) => {
        if (!p.paused) return next();
        next(
          new HttpError(
            503,
            'BOOKINGS_PAUSED',
            p.message || 'New bookings are paused for a short while. Please try again later.',
            undefined,
            { 'Cache-Control': 'no-store' },
          ),
        );
      })
      .catch(next);
  };
}

export function siteStatusRouter(deps: {
  maintenance: MaintenanceService;
  bookingsPause: BookingsPauseService;
  audit: AuditService;
  authenticate: RequestHandler;
  /** Browser error tracking (Sentry). The DSN is public by design; null = off. */
  webErrorTracking?: { dsn: string | null; environment: string };
}): Router {
  const { maintenance, bookingsPause, audit, authenticate } = deps;
  const r = Router();

  /** Public: the web app, the maintenance page and the banners read this. */
  r.get('/status', async (_req, res) => {
    const [m, b] = await Promise.all([maintenance.get(), bookingsPause.get()]);
    res.set('Cache-Control', 'no-store').json({
      maintenance: m,
      bookings: b,
      errorTracking: deps.webErrorTracking ?? { dsn: null, environment: 'development' },
    });
  });

  const audited = <T>(
    path: string,
    store: SettingStore<T>,
    schema: z.ZodType<T>,
    action: AuditAction,
  ) =>
    r.put(path, authenticate, requirePermission('settings:update'), async (req, res) => {
      const me = currentUser(req);
      const value = schema.parse(req.body);
      const { before, after } = await store.set(value, me.userId);
      await audit.record(
        {
          action,
          entityType: 'platform_settings',
          entityId: store.key,
          actorId: me.userId,
          actorRole: me.role,
          before,
          after,
        },
        auditContext(req),
      );
      res.json(after);
    });

  /** Super admins switch maintenance (and its advance notice) and the bookings pause. */
  audited(
    '/admin/maintenance',
    maintenance,
    maintenanceUpdateSchema,
    'settings.maintenance_changed',
  );
  audited(
    '/admin/bookings-pause',
    bookingsPause,
    bookingsPauseSchema,
    'settings.bookings_pause_changed',
  );
  return r;
}
