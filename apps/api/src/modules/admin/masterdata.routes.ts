import { Router } from 'express';
import { asc, eq, gte } from 'drizzle-orm';
import {
  amenitySchema,
  amenityUpdateSchema,
  citySchema,
  cityUpdateSchema,
  muhurthamDateSchema,
  platformSettingsUpdateSchema,
} from '@mandapambook/shared';
import { z } from 'zod';
import { type Db, PG_ERROR, pgErrorCode } from '../../db/client.js';
import { amenities, cities, muhurthamDates } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { todayInIst } from '../../lib/time.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { parseId } from '../owners/scoped.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import type { SettingsService } from '../settings/settings.service.js';

/** Maps a unique-key clash to a clear 409 instead of a 500. */
async function unique<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION)
      throw errors.conflict('ALREADY_EXISTS', message);
    throw err;
  }
}

export function masterDataRouter(deps: {
  db: Db;
  audit: AuditService;
  settings: SettingsService;
}): Router {
  const { db, audit, settings } = deps;
  const r = Router();

  const record = (
    req: Parameters<typeof auditContext>[0],
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) => {
    const me = currentUser(req);
    return audit.record(
      {
        action: 'masterdata.changed',
        entityType,
        entityId,
        actorId: me.userId,
        actorRole: me.role,
        before,
        after,
      },
      auditContext(req),
    );
  };

  // ------------------------------------------------------------ cities

  r.get('/cities', requirePermission('masterdata:update'), async (_req, res) => {
    res.json({
      items: await db.select().from(cities).orderBy(asc(cities.state), asc(cities.name)),
    });
  });

  r.post('/cities', requirePermission('masterdata:update'), async (req, res) => {
    const input = citySchema.parse(req.body);
    const [row] = await unique(
      () => db.insert(cities).values(input).returning(),
      'A city with this slug already exists',
    );
    if (!row) throw new Error('city insert returned nothing');
    await record(req, 'city', row.id, null, input);
    res.status(201).json(row);
  });

  /** Cities are deactivated, never deleted, because venues reference them. */
  r.patch('/cities/:id', requirePermission('masterdata:update'), async (req, res) => {
    const id = parseId(req.params['id']);
    const input = cityUpdateSchema.parse(req.body);
    const [before] = await db.select().from(cities).where(eq(cities.id, id));
    if (!before) throw errors.notFound();
    const [row] = await db.update(cities).set(input).where(eq(cities.id, id)).returning();
    await record(req, 'city', id, before, row);
    res.json(row);
  });

  // ------------------------------------------------------------ amenities

  r.get('/amenities', requirePermission('masterdata:update'), async (_req, res) => {
    res.json({
      items: await db
        .select()
        .from(amenities)
        .orderBy(asc(amenities.sortOrder), asc(amenities.name)),
    });
  });

  r.post('/amenities', requirePermission('masterdata:update'), async (req, res) => {
    const input = amenitySchema.parse(req.body);
    const [row] = await unique(
      () => db.insert(amenities).values(input).returning(),
      'An amenity with this code already exists',
    );
    if (!row) throw new Error('amenity insert returned nothing');
    await record(req, 'amenity', row.id, null, input);
    res.status(201).json(row);
  });

  r.patch('/amenities/:id', requirePermission('masterdata:update'), async (req, res) => {
    const id = parseId(req.params['id']);
    const input = amenityUpdateSchema.parse(req.body);
    const [before] = await db.select().from(amenities).where(eq(amenities.id, id));
    if (!before) throw errors.notFound();
    const [row] = await db.update(amenities).set(input).where(eq(amenities.id, id)).returning();
    await record(req, 'amenity', id, before, row);
    res.json(row);
  });

  // ------------------------------------------------------------ muhurtham dates

  r.get('/muhurtham-dates', requirePermission('masterdata:update'), async (_req, res) => {
    const items = await db
      .select()
      .from(muhurthamDates)
      .where(gte(muhurthamDates.date, todayInIst()))
      .orderBy(asc(muhurthamDates.date));
    res.json({ items });
  });

  r.post('/muhurtham-dates', requirePermission('masterdata:update'), async (req, res) => {
    const input = muhurthamDateSchema.parse(req.body);
    const [row] = await unique(
      () =>
        db
          .insert(muhurthamDates)
          .values({ date: input.date, label: input.label ?? null, state: input.state ?? null })
          .returning(),
      'That date is already listed',
    );
    await record(req, 'muhurtham_date', input.date, null, row);
    res.status(201).json(row);
  });

  r.delete('/muhurtham-dates/:date', requirePermission('masterdata:update'), async (req, res) => {
    const date = z.iso.date().safeParse(req.params['date']);
    if (!date.success) throw errors.notFound();
    const removed = await db
      .delete(muhurthamDates)
      .where(eq(muhurthamDates.date, date.data))
      .returning();
    if (!removed.length) throw errors.notFound();
    await record(req, 'muhurtham_date', date.data, removed[0], null);
    res.status(204).end();
  });

  // ------------------------------------------------------------ platform settings

  r.get('/settings', requirePermission('report:view'), async (_req, res) => {
    res.json(await settings.get());
  });

  /** Super admin only. Affects new quotes; existing bookings keep their price snapshot. */
  r.put('/settings', requirePermission('settings:update'), async (req, res) => {
    const me = currentUser(req);
    const changes = platformSettingsUpdateSchema.parse(req.body);
    const { before, after } = await settings.update(changes, me.userId);
    await audit.record(
      {
        action: 'settings.changed',
        entityType: 'platform_settings',
        entityId: 'platform',
        actorId: me.userId,
        actorRole: me.role,
        before,
        after,
      },
      auditContext(req),
    );
    res.json(after);
  });

  return r;
}
