import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoriums } from '../../../src/db/schema/index.js';
import { createVenueFixture, hasTestDb } from '../../db-helpers.js';
import { type Harness, createHarness } from '../../auth-harness.js';

describe.skipIf(!hasTestDb)('search engines and link previews', { timeout: 120_000 }, () => {
  let h: Harness;
  let slug: string;

  beforeAll(async () => {
    h = await createHarness();
    const f = await createVenueFixture(h.db);
    await h.db
      .update(auditoriums)
      .set({ description: 'A grand hall with <b>sadya</b> & parking.' })
      .where(eq(auditoriums.id, f.auditoriumId));
    const [a] = await h.db
      .select({ slug: auditoriums.slug })
      .from(auditoriums)
      .where(eq(auditoriums.id, f.auditoriumId));
    slug = a!.slug;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('serves robots.txt that keeps private areas out and points at the sitemap', async () => {
    const res = await request(h.app).get('/api/v1/seo/robots.txt');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/plain');
    expect(res.text).toContain('Disallow: /admin');
    expect(res.text).toContain('Disallow: /account');
    expect(res.text).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });

  it('lists the public pages and approved venues in the sitemap', async () => {
    const res = await request(h.app).get('/api/v1/seo/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/xml');
    expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(res.text).toContain(`/venues/${slug}</loc>`);
    expect(res.text).toContain('/refund-policy</loc>');
  });

  it("gives link-preview bots a venue's name, city, description and a stable photo link", async () => {
    const res = await request(h.app).get(`/api/v1/seo/share?path=/venues/${slug}`);
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toMatch(
      /<meta property="og:title" content="Hall [^"]+, City [^"]+ · MandapamBook"/,
    );
    expect(res.text).toContain(
      'content="A grand hall with &lt;b&gt;sadya&lt;/b&gt; &amp; parking."',
    );
    expect(res.text).toContain(`/api/v1/seo/venue-photo/${slug}"`);
    expect(res.text).not.toContain('<b>sadya</b>');
  });

  it('falls back to the site preview for other pages and unknown venues, safely', async () => {
    for (const path of [
      '/',
      '/venues/no-such-hall',
      '/search?q=x',
      '/"><script>alert(1)</script>',
    ]) {
      const res = await request(h.app).get(`/api/v1/seo/share?path=${encodeURIComponent(path)}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('og:image" content="');
      expect(res.text).not.toContain('<script>');
    }
    // A venue without photos still previews with the site card.
    const photo = await request(h.app).get(`/api/v1/seo/venue-photo/${slug}`);
    expect(photo.status).toBe(302);
    expect(photo.headers['location']).toMatch(/\/og-image\.png$/);
    expect((await request(h.app).get('/api/v1/seo/venue-photo/BAD SLUG')).status).toBe(302);
  });
});
