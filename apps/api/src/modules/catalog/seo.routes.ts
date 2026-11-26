import { Router } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { auditoriums, cities, media } from '../../db/schema/index.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { escapeHtml } from '../notifications/email-layout.js';

const SITE_DESCRIPTION =
  'Find and book kalyana mandapams, wedding halls and auditoriums across Kerala. Compare prices, check dates and pay the advance online.';

/** Pages crawlers should not index: personal, owner and admin areas, checkout steps. */
const PRIVATE_PATHS = [
  '/account',
  '/owner',
  '/admin',
  '/book/',
  '/payments/',
  '/verify-email',
  '/reset-password',
];

const slugSchema = z.string().regex(/^[a-z0-9-]{1,120}$/);

/**
 * Search and link-preview support. The web server sends /robots.txt, /sitemap.xml and
 * requests from link-preview bots (WhatsApp, Facebook, Telegram, X…) here, because those
 * bots do not run the app's JavaScript and would otherwise see a blank page.
 */
export function seoRouter(deps: {
  db: Db;
  storage: ObjectStorage;
  appBaseUrl: string;
  /** SEO_INDEXING: false keeps the whole site out of search engines. */
  indexing?: boolean;
}): Router {
  const { db, storage } = deps;
  const base = deps.appBaseUrl.replace(/\/$/, '');
  const indexing = deps.indexing ?? true;
  const r = Router();

  r.get('/seo/robots.txt', (_req, res) => {
    if (!indexing) {
      res
        .type('text/plain')
        .set('Cache-Control', 'public, max-age=3600')
        .send('# Not open to search engines yet.\nUser-agent: *\nDisallow: /\n');
      return;
    }
    const lines = [
      'User-agent: *',
      'Allow: /',
      ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
      '',
      `Sitemap: ${base}/sitemap.xml`,
      '',
    ];
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(lines.join('\n'));
  });

  r.get('/seo/sitemap.xml', async (_req, res) => {
    if (!indexing) {
      res
        .type('application/xml')
        .set('Cache-Control', 'public, max-age=3600')
        .send(
          '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n',
        );
      return;
    }
    const venues = await db
      .select({ slug: auditoriums.slug, updatedAt: auditoriums.updatedAt })
      .from(auditoriums)
      .where(eq(auditoriums.status, 'APPROVED'))
      .orderBy(desc(auditoriums.updatedAt))
      .limit(45_000);
    const url = (loc: string, lastmod?: Date) =>
      `  <url><loc>${escapeHtml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      url(`${base}/`),
      url(`${base}/search`),
      ...['terms', 'privacy', 'refund-policy', 'contact'].map((p) => url(`${base}/${p}`)),
      ...venues.map((v) => url(`${base}/venues/${v.slug}`, v.updatedAt)),
      '</urlset>',
      '',
    ].join('\n');
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
  });

  /** A stable address for a venue's lead photo, so cached previews never point at an expired link. */
  r.get('/seo/venue-photo/:slug', async (req, res) => {
    const slug = slugSchema.safeParse(req.params['slug']);
    const photo = slug.success ? await leadPhoto(slug.data) : null;
    if (!photo) {
      res.redirect(302, `${base}/og-image.png`);
      return;
    }
    res
      .set('Cache-Control', 'public, max-age=300')
      .redirect(302, await storage.createDownloadUrl(photo, 3600));
  });

  /** The page link-preview bots see: title, description and image for the shared URL. */
  r.get('/seo/share', async (req, res) => {
    const path = z.string().max(300).catch('/').parse(req.query['path']);
    const page = await describe(path);
    const canonical = `${base}${path.startsWith('/') ? path : '/'}`;
    const e = escapeHtml;
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${e(page.title)}</title>
<meta name="description" content="${e(page.description)}" />
<link rel="canonical" href="${e(canonical)}" />
<meta property="og:site_name" content="MandapamBook" />
<meta property="og:type" content="${page.type}" />
<meta property="og:title" content="${e(page.title)}" />
<meta property="og:description" content="${e(page.description)}" />
<meta property="og:url" content="${e(canonical)}" />
<meta property="og:image" content="${e(page.image)}" />
<meta property="og:locale" content="en_IN" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${e(page.title)}" />
<meta name="twitter:description" content="${e(page.description)}" />
<meta name="twitter:image" content="${e(page.image)}" />
</head>
<body><h1>${e(page.title)}</h1><p>${e(page.description)}</p><p><a href="${e(canonical)}">Open on MandapamBook</a></p></body>
</html>`;
    res.type('text/html').set('Cache-Control', 'public, max-age=600').send(html);
  });

  async function leadPhoto(slug: string): Promise<string | null> {
    const [row] = await db
      .select({ key: media.storageKey })
      .from(media)
      .innerJoin(auditoriums, eq(auditoriums.id, media.auditoriumId))
      .where(
        and(
          eq(auditoriums.slug, slug),
          eq(auditoriums.status, 'APPROVED'),
          eq(media.status, 'READY'),
        ),
      )
      .orderBy(asc(media.sortOrder), asc(media.createdAt))
      .limit(1);
    return row?.key ?? null;
  }

  async function describe(path: string): Promise<{
    title: string;
    description: string;
    image: string;
    type: 'website' | 'place';
  }> {
    const site = {
      title: 'MandapamBook · Book wedding halls and kalyana mandapams',
      description: SITE_DESCRIPTION,
      image: `${base}/og-image.png`,
      type: 'website' as const,
    };
    const venueSlug = /^\/venues\/([a-z0-9-]{1,120})\/?$/.exec(path)?.[1];
    if (venueSlug) {
      const [v] = await db
        .select({
          name: auditoriums.name,
          description: auditoriums.description,
          locality: auditoriums.locality,
          city: cities.name,
        })
        .from(auditoriums)
        .innerJoin(cities, eq(cities.id, auditoriums.cityId))
        .where(and(eq(auditoriums.slug, venueSlug), eq(auditoriums.status, 'APPROVED')));
      if (!v) return site;
      const place = [v.locality, v.city].filter(Boolean).join(', ');
      const summary = (v.description ?? '').replace(/\s+/g, ' ').trim();
      return {
        title: `${v.name}, ${v.city} · MandapamBook`,
        description: summary
          ? `${summary.slice(0, 180)}${summary.length > 180 ? '…' : ''}`
          : `Wedding and event venue in ${place}. Check dates, prices and book online on MandapamBook.`,
        image: `${base}/api/v1/seo/venue-photo/${venueSlug}`,
        type: 'place',
      };
    }
    if (path.startsWith('/search')) return { ...site, title: 'Find a wedding hall · MandapamBook' };
    return site;
  }

  return r;
}
