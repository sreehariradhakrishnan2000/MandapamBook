import { type Maintenance, maintenanceSchema } from '@mandapambook/shared';
import { eq } from 'drizzle-orm';
import { type RequestHandler, Router } from 'express';
import type { Db } from '../../db/client.js';
import { platformSettings } from '../../db/schema/index.js';
import { HttpError } from '../../http/errors.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import type { RevocationStore } from '../../infra/revocation-store.js';
import type { AccessTokenService } from '../auth/access-tokens.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';

const KEY = 'maintenance';
const OFF: Maintenance = { enabled: false, message: '', until: null };
/** How long a read is reused. Switching on or off reaches every instance within this. */
const CACHE_MS = 5_000;

/** The maintenance switch, stored as one row in platform_settings (no migration needed). */
export class MaintenanceService {
  private cached: { value: Maintenance; at: number } | null = null;

  constructor(private readonly db: Db) {}

  async get(): Promise<Maintenance> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const [row] = await this.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, KEY));
    const parsed = maintenanceSchema.safeParse(row?.value);
    const value = parsed.success ? parsed.data : OFF;
    this.cached = { value, at: Date.now() };
    return value;
  }

  async set(
    value: Maintenance,
    actorId: string,
  ): Promise<{ before: Maintenance; after: Maintenance }> {
    const before = await this.get();
    await this.db
      .insert(platformSettings)
      .values({ key: KEY, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: actorId } });
    this.cached = { value, at: Date.now() };
    return { before, after: value };
  }
}

/**
 * Paths that keep working during maintenance: the status the maintenance page polls,
 * sign-in (so staff can get in) and payment webhooks (money that moved must be recorded).
 */
const ALWAYS_OPEN = [/^\/status$/, /^\/auth\//, /^\/payments\/webhooks\//];
const STAFF_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

/**
 * While maintenance is on, answers everyone except admins with 503 MAINTENANCE. The web
 * app turns that into the maintenance page. Admin routes still run their own full
 * authentication; this only decides who gets past the "closed" sign.
 */
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

export function maintenanceGate(
  maintenance: MaintenanceService,
  tokens: AccessTokenService,
  revocations: RevocationStore,
): RequestHandler {
  return (req, res, next) => {
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

export function maintenanceRouter(deps: {
  maintenance: MaintenanceService;
  audit: AuditService;
  authenticate: RequestHandler;
}): Router {
  const { maintenance, audit, authenticate } = deps;
  const r = Router();

  /** Public: the web app and the maintenance page read this. */
  r.get('/status', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ maintenance: await maintenance.get() });
  });

  /** Super admins switch maintenance on or off. Audited. */
  r.put(
    '/admin/maintenance',
    authenticate,
    requirePermission('settings:update'),
    async (req, res) => {
      const me = currentUser(req);
      const value = maintenanceSchema.parse(req.body);
      const { before, after } = await maintenance.set(value, me.userId);
      await audit.record(
        {
          action: 'settings.maintenance_changed',
          entityType: 'platform_settings',
          entityId: KEY,
          actorId: me.userId,
          actorRole: me.role,
          before,
          after,
        },
        auditContext(req),
      );
      res.json(after);
    },
  );
  return r;
}
