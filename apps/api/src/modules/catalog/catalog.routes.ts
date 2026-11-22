import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { amenities, cities } from '../../db/schema/index.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { venuesRouter } from './venues.routes.js';

/** Public reference data. Cached briefly by browsers and CDNs; contains nothing private. */
export function catalogRouter({ db, storage }: { db: Db; storage: ObjectStorage }): Router {
  const r = Router();
  r.use(venuesRouter({ db, storage }));
  const cache = 'public, max-age=300';

  r.get('/cities', async (_req, res) => {
    const items = await db
      .select({
        id: cities.id,
        name: cities.name,
        slug: cities.slug,
        district: cities.district,
        state: cities.state,
        nameI18n: cities.nameI18n,
      })
      .from(cities)
      .where(eq(cities.isActive, true))
      .orderBy(asc(cities.state), asc(cities.name));
    res.set('Cache-Control', cache).json({ items });
  });

  r.get('/amenities', async (_req, res) => {
    const items = await db
      .select({
        code: amenities.code,
        name: amenities.name,
        icon: amenities.icon,
        nameI18n: amenities.nameI18n,
      })
      .from(amenities)
      .where(eq(amenities.isActive, true))
      .orderBy(asc(amenities.sortOrder), asc(amenities.name));
    res.set('Cache-Control', cache).json({ items });
  });

  return r;
}
