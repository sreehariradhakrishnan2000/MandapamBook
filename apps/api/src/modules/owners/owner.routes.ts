import { type RequestHandler, Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { auditoriums, halls } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { auditoriumScopeCondition, resolveOwnerScope } from '../rbac/owner-scope.js';

export interface OwnerRouterDeps {
  db: Db;
  authenticate: RequestHandler;
}

/**
 * Read-only owner venue endpoints (full CRUD arrives in Phase 3). Every query is filtered
 * by the caller's owner scope; another owner's venue is indistinguishable from a missing one.
 */
export function ownerRouter({ db, authenticate }: OwnerRouterDeps): Router {
  const r = Router();
  r.use(authenticate);

  const summary = {
    id: auditoriums.id,
    name: auditoriums.name,
    slug: auditoriums.slug,
    status: auditoriums.status,
    cityId: auditoriums.cityId,
    updatedAt: auditoriums.updatedAt,
  };

  r.get('/auditoriums', requirePermission('booking:view_venue'), async (req, res) => {
    const scope = await resolveOwnerScope(db, currentUser(req));
    const items = await db
      .select(summary)
      .from(auditoriums)
      .where(auditoriumScopeCondition(scope))
      .orderBy(asc(auditoriums.name));
    res.json({ items });
  });

  r.get('/auditoriums/:id', requirePermission('booking:view_venue'), async (req, res) => {
    const id = z.uuid().safeParse(req.params['id']);
    if (!id.success) throw errors.notFound();
    const scope = await resolveOwnerScope(db, currentUser(req));
    const [venue] = await db
      .select(summary)
      .from(auditoriums)
      .where(and(eq(auditoriums.id, id.data), auditoriumScopeCondition(scope)));
    if (!venue) throw errors.notFound();
    const hallRows = await db
      .select({ id: halls.id, name: halls.name, seatingCapacity: halls.seatingCapacity })
      .from(halls)
      .where(eq(halls.auditoriumId, venue.id))
      .orderBy(asc(halls.name));
    res.json({ ...venue, halls: hallRows });
  });

  return r;
}
