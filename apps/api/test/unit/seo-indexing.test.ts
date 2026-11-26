import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.js';
import type { ObjectStorage } from '../../src/infra/storage.js';
import { seoRouter } from '../../src/modules/catalog/seo.routes.js';

describe('SEO_INDEXING off (e.g. production with only test venues)', () => {
  const app = express().use(
    '/api/v1',
    seoRouter({
      // Never queried when indexing is off.
      db: {} as Db,
      storage: {} as ObjectStorage,
      appBaseUrl: 'https://mandapambooking.in',
      indexing: false,
    }),
  );

  it('tells every crawler to stay out', async () => {
    const res = await request(app).get('/api/v1/seo/robots.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('User-agent: *\nDisallow: /\n');
    expect(res.text).not.toContain('Sitemap:');
  });

  it('serves an empty sitemap', async () => {
    const res = await request(app).get('/api/v1/seo/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<urlset');
    expect(res.text).not.toContain('<url>');
  });
});
