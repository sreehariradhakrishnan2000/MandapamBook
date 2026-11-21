import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers.js';

describe('app shell', () => {
  it('GET /health returns ok with security headers and a request id', async () => {
    const res = await request(buildTestApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps a well-formed inbound request id and replaces a malformed one', async () => {
    const app = buildTestApp();
    const ok = await request(app).get('/health').set('X-Request-Id', 'abc-12345678');
    expect(ok.headers['x-request-id']).toBe('abc-12345678');
    const bad = await request(app).get('/health').set('X-Request-Id', '<script>');
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });

  it('GET /ready is 200 when every check passes', async () => {
    const app = buildTestApp({ database: async () => {}, redis: async () => {} });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: 'ok', redis: 'ok' } });
  });

  it('GET /ready is 503 when a dependency fails, without leaking details', async () => {
    const app = buildTestApp({
      database: async () => {},
      redis: async () => {
        throw new Error('connect ECONNREFUSED redis://user:pw@10.0.0.5');
      },
    });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ database: 'ok', redis: 'fail' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('GET /ready fails a check that hangs', async () => {
    const app = buildTestApp({ database: () => new Promise(() => {}) });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
  }, 5000);

  it('returns a structured 404 carrying the correlation id', async () => {
    const res = await request(buildTestApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.correlationId).toBe(res.headers['x-request-id']);
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/anything')
      .send({ blob: 'x'.repeat(5000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_BODY');
  });

  it('allows only allowlisted CORS origins', async () => {
    const app = buildTestApp();
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:4200');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
