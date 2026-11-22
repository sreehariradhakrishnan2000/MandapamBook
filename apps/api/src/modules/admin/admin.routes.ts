import { type RequestHandler, Router } from 'express';
import { and, count, desc, eq, ilike, lt, or, type SQL } from 'drizzle-orm';
import {
  adminUserQuerySchema,
  ownerBookingQuerySchema,
  roleChangeSchema,
} from '@mandapambook/shared';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  auditLogs,
  auditoriums,
  bookings,
  cities,
  halls,
  ownerProfiles,
  users,
} from '../../db/schema/index.js';
import { bookingSummary } from '../bookings/bookings.routes.js';
import { errors } from '../../http/errors.js';
import type { ObjectStorage } from '../../infra/storage.js';
import type { FieldCrypto } from '../../lib/field-crypto.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import type { AuthService } from '../auth/auth.service.js';
import type { EmailSender } from '../notifications/senders.js';
import { parseId } from '../owners/scoped.js';
import type { PaymentService } from '../payments/payment.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { kycReviewRouter } from './kyc-review.routes.js';
import { escapeLike, listingsReviewRouter } from './listings-review.routes.js';
import { masterDataRouter } from './masterdata.routes.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';

const statusChangeSchema = z.strictObject({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().min(3).max(500),
});

const auditQuerySchema = z.strictObject({
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(60).optional(),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface AdminRouterDeps {
  db: Db;
  auth: AuthService;
  audit: AuditService;
  authenticate: RequestHandler;
  storage: ObjectStorage;
  crypto: FieldCrypto;
  email: EmailSender;
  settings: SettingsService;
  payments: PaymentService;
  appBaseUrl: string;
}

/** Safe user fields for admin screens: never password hashes or lockout internals. */
const userSummary = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  phone: users.phone,
  role: users.role,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  phoneVerifiedAt: users.phoneVerifiedAt,
  lastLoginAt: users.lastLoginAt,
  lockedUntil: users.lockedUntil,
  createdAt: users.createdAt,
};

export function adminRouter(deps: AdminRouterDeps): Router {
  const { db, auth, audit, authenticate } = deps;
  const r = Router();
  r.use(authenticate);
  r.use(
    listingsReviewRouter({
      db,
      audit,
      storage: deps.storage,
      email: deps.email,
      appBaseUrl: deps.appBaseUrl,
    }),
  );
  r.use(
    kycReviewRouter({
      db,
      audit,
      crypto: deps.crypto,
      email: deps.email,
      appBaseUrl: deps.appBaseUrl,
    }),
  );
  r.use(masterDataRouter({ db, audit, settings: deps.settings }));

  r.get('/bookings', requirePermission('booking:view_all'), async (req, res) => {
    const q = ownerBookingQuerySchema.parse(req.query);
    const items = await db
      .select({ ...bookingSummary, customerEmail: users.email })
      .from(bookings)
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .innerJoin(halls, eq(halls.id, bookings.hallId))
      .innerJoin(cities, eq(cities.id, auditoriums.cityId))
      .innerJoin(users, eq(users.id, bookings.customerId))
      .where(q.status ? eq(bookings.status, q.status) : undefined)
      .orderBy(desc(bookings.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.set('Cache-Control', 'no-store').json({ items });
  });

  /** Goodwill or dispute refund, bounded by what is still refundable. Audited. */
  r.post('/bookings/:id/refund', requirePermission('refund:issue'), async (req, res) => {
    const me = currentUser(req);
    const id = parseId(req.params['id']);
    const input = z
      .strictObject({
        amountPaise: z.number().int().min(1),
        reason: z.string().trim().min(10).max(500),
        idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
      })
      .parse(req.body);
    const [b] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, id));
    if (!b) throw errors.notFound('Booking not found');
    const result = await deps.payments.refundBooking({
      bookingId: id,
      amountPaise: input.amountPaise,
      purpose: `admin:${input.idempotencyKey}`,
      reason: input.reason,
      actorId: me.userId,
      ctx: auditContext(req),
    });
    res.json(result);
  });

  r.get('/users', requirePermission('user:manage'), async (req, res) => {
    const q = adminUserQuerySchema.parse(req.query);
    const where = and(
      q.role ? eq(users.role, q.role) : undefined,
      q.status ? eq(users.status, q.status) : undefined,
      q.q
        ? or(
            ilike(users.email, `%${escapeLike(q.q)}%`),
            ilike(users.fullName, `%${escapeLike(q.q)}%`),
            ilike(users.phone, `%${escapeLike(q.q)}%`),
          )
        : undefined,
    );
    const [items, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select(userSummary)
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      db.select({ total: count() }).from(users).where(where),
    ]);
    res.set('Cache-Control', 'no-store').json({ items, total, limit: q.limit, offset: q.offset });
  });

  r.get('/users/:id', requirePermission('user:manage'), async (req, res) => {
    const id = parseId(req.params['id']);
    const [user] = await db
      .select({
        ...userSummary,
        businessName: ownerProfiles.businessName,
        kycStatus: ownerProfiles.kycStatus,
      })
      .from(users)
      .leftJoin(ownerProfiles, eq(ownerProfiles.userId, users.id))
      .where(eq(users.id, id));
    if (!user) throw errors.notFound('User not found');
    res.set('Cache-Control', 'no-store').json(user);
  });

  /** Changing roles is super-admin only; every change is audited and ends the user's sessions. */
  r.patch('/users/:id/role', requirePermission('user:role_change'), async (req, res) => {
    const actor = currentUser(req);
    const targetId = z.uuid().parse(req.params['id']);
    const { role } = roleChangeSchema.parse(req.body);
    if (targetId === actor.userId) throw errors.forbidden('You cannot change your own role');

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(users).where(eq(users.id, targetId)).for('update');
      if (!before) throw errors.notFound('User not found');
      if (before.role === role) return before;
      const [after] = await tx
        .update(users)
        .set({ role, permissionsVersion: before.permissionsVersion + 1 })
        .where(eq(users.id, targetId))
        .returning();
      await audit.record(
        {
          action: 'user.role_changed',
          entityType: 'user',
          entityId: targetId,
          actorId: actor.userId,
          actorRole: actor.role,
          before: { role: before.role },
          after: { role },
        },
        auditContext(req),
        tx,
      );
      return after ?? before;
    });
    // Outstanding access tokens carry the old role: cut them off.
    await auth.revokeAllSessions(targetId, 'role_changed');
    res.json({ id: updated.id, role: updated.role });
  });

  r.patch('/users/:id/status', requirePermission('user:manage'), async (req, res) => {
    const actor = currentUser(req);
    const targetId = z.uuid().parse(req.params['id']);
    const { status, reason } = statusChangeSchema.parse(req.body);
    if (targetId === actor.userId) throw errors.forbidden('You cannot change your own status');

    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(users).where(eq(users.id, targetId)).for('update');
      if (!before) throw errors.notFound('User not found');
      // Only super admins may act on other admins.
      if (
        (before.role === 'SUPER_ADMIN' || before.role === 'ADMIN') &&
        actor.role !== 'SUPER_ADMIN'
      ) {
        throw errors.forbidden('Only a super admin can change an admin account');
      }
      await tx.update(users).set({ status }).where(eq(users.id, targetId));
      await audit.record(
        {
          action: 'user.status_changed',
          entityType: 'user',
          entityId: targetId,
          actorId: actor.userId,
          actorRole: actor.role,
          before: { status: before.status },
          after: { status, reason },
        },
        auditContext(req),
        tx,
      );
    });
    if (status === 'SUSPENDED') await auth.revokeAllSessions(targetId, 'suspended');
    res.status(204).end();
  });

  r.get('/audit-logs', requirePermission('audit:view'), async (req, res) => {
    const q = auditQuerySchema.parse(req.query);
    const conditions: SQL[] = [];
    if (q.entityType) conditions.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) conditions.push(eq(auditLogs.entityId, q.entityId));
    if (q.actorId) conditions.push(eq(auditLogs.actorId, q.actorId));
    if (q.action) conditions.push(eq(auditLogs.action, q.action));
    if (q.before) conditions.push(lt(auditLogs.createdAt, new Date(q.before)));
    const rows = await db
      .select()
      .from(auditLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(q.limit);
    res.json({
      items: rows,
      nextBefore: rows.length === q.limit ? rows.at(-1)?.createdAt.toISOString() : null,
    });
  });

  return r;
}
