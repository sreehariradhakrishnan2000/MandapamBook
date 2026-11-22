import { Router } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { staffInviteSchema, staffUpdateSchema } from '@mandapambook/shared';
import { type Db, PG_ERROR, pgErrorCode } from '../../db/client.js';
import { auditoriums, ownerStaff, users } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import type { AuthService } from '../auth/auth.service.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { type ScopedResources, parseId, requireOwner } from './scoped.js';

export function staffRouter(deps: {
  db: Db;
  scoped: ScopedResources;
  auth: AuthService;
  audit: AuditService;
}): Router {
  const { db, scoped, auth, audit } = deps;
  const r = Router();

  /** Every venue id must belong to the calling owner; otherwise the whole request fails. */
  async function assertOwnVenues(ownerId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await db
      .select({ id: auditoriums.id })
      .from(auditoriums)
      .where(and(eq(auditoriums.ownerId, ownerId), inArray(auditoriums.id, unique)));
    if (rows.length !== unique.length)
      throw errors.badRequest('UNKNOWN_VENUE', 'One or more venues were not found');
    return unique;
  }

  r.get('/staff', requirePermission('staff:manage'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const items = await db
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
        auditoriumIds: ownerStaff.auditoriumIds,
        invitedAt: ownerStaff.createdAt,
      })
      .from(ownerStaff)
      .innerJoin(users, eq(users.id, ownerStaff.userId))
      .where(eq(ownerStaff.ownerId, scope.ownerId));
    res.json({ items });
  });

  /**
   * Creates a new staff account; existing accounts are never converted, so an owner
   * cannot change another person's role. The invitee sets a password from the email.
   */
  r.post('/staff', requirePermission('staff:manage'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const input = staffInviteSchema.parse(req.body);
    const venueIds = await assertOwnVenues(scope.ownerId, input.auditoriumIds);

    let userId: string;
    try {
      userId = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            email: input.email,
            fullName: input.fullName,
            role: 'OWNER_STAFF',
            status: 'PENDING_VERIFICATION',
          })
          .returning({ id: users.id });
        if (!user) throw new Error('staff insert failed');
        await tx.insert(ownerStaff).values({
          ownerId: scope.ownerId,
          userId: user.id,
          auditoriumIds: venueIds,
          invitedBy: me.userId,
        });
        await audit.record(
          {
            action: 'staff.invited',
            entityType: 'user',
            entityId: user.id,
            actorId: me.userId,
            actorRole: me.role,
            after: { ownerId: scope.ownerId, auditoriumIds: venueIds },
          },
          auditContext(req),
          tx,
        );
        return user.id;
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
        throw errors.conflict(
          'EMAIL_IN_USE',
          'This email already has a MandapamBook account. Use a different email for staff.',
        );
      }
      throw err;
    }
    await auth.sendSetPasswordEmail(userId);
    res.status(201).json({ userId, email: input.email, auditoriumIds: venueIds });
  });

  r.patch('/staff/:userId', requirePermission('staff:manage'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const staffId = parseId(req.params['userId']);
    const { auditoriumIds } = staffUpdateSchema.parse(req.body);
    const venueIds = await assertOwnVenues(scope.ownerId, auditoriumIds);
    const [before] = await db
      .select()
      .from(ownerStaff)
      .where(and(eq(ownerStaff.ownerId, scope.ownerId), eq(ownerStaff.userId, staffId)));
    if (!before) throw errors.notFound();
    await db
      .update(ownerStaff)
      .set({ auditoriumIds: venueIds })
      .where(eq(ownerStaff.userId, staffId));
    await audit.record(
      {
        action: 'staff.updated',
        entityType: 'user',
        entityId: staffId,
        actorId: me.userId,
        actorRole: me.role,
        before: { auditoriumIds: before.auditoriumIds },
        after: { auditoriumIds: venueIds },
      },
      auditContext(req),
    );
    res.json({ userId: staffId, auditoriumIds: venueIds });
  });

  /** Removing staff unlinks them, suspends the account and ends their sessions at once. */
  r.delete('/staff/:userId', requirePermission('staff:manage'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const staffId = parseId(req.params['userId']);
    const removed = await db
      .delete(ownerStaff)
      .where(and(eq(ownerStaff.ownerId, scope.ownerId), eq(ownerStaff.userId, staffId)))
      .returning();
    if (removed.length === 0) throw errors.notFound();
    await db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, staffId));
    await auth.revokeAllSessions(staffId, 'staff_removed');
    await audit.record(
      {
        action: 'staff.removed',
        entityType: 'user',
        entityId: staffId,
        actorId: me.userId,
        actorRole: me.role,
        before: { ownerId: scope.ownerId },
      },
      auditContext(req),
    );
    res.status(204).end();
  });

  return r;
}
