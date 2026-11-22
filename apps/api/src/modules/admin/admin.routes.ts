import { type RequestHandler, Router } from 'express';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { roleChangeSchema } from '@mandapambook/shared';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { auditLogs, users } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import type { AuthService } from '../auth/auth.service.js';
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
}

export function adminRouter({ db, auth, audit, authenticate }: AdminRouterDeps): Router {
  const r = Router();
  r.use(authenticate);

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
