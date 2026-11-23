import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  PROXY_CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  clientIp,
} from '../../src/http/middleware/client-ip.js';

const SECRET = 'x'.repeat(43);

function appWith(opts: Parameters<typeof clientIp>[0], trustProxyHops = 0) {
  const app = express();
  app.set('trust proxy', trustProxyHops);
  app.use(clientIp(opts));
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}
const ipOf = async (app: express.Express, headers: Record<string, string> = {}) =>
  (await request(app).get('/ip').set(headers)).body.ip as string;

describe('clientIp', () => {
  it("keeps Express's req.ip when nothing is configured (local, CI, tests)", async () => {
    const app = appWith({});
    const ip = await ipOf(app, {
      'cf-connecting-ip': '203.0.113.7',
      [PROXY_CLIENT_IP_HEADER]: '1.2.3.4',
    });
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it("uses the edge's client-IP header instead of counting X-Forwarded-For", async () => {
    const app = appWith({ edgeHeader: 'CF-Connecting-IP' }, 5);
    expect(
      await ipOf(app, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6, 9.9.9.9' }),
    ).toBe('203.0.113.7');
  });

  it("trusts our web proxy's x-mb-client-ip only with the shared secret", async () => {
    const app = appWith({ edgeHeader: 'cf-connecting-ip', proxySecret: SECRET });
    const proxied = { 'cf-connecting-ip': '198.51.100.1', [PROXY_CLIENT_IP_HEADER]: '203.0.113.7' };
    // From our nginx: the browser's IP, not nginx's own outbound address.
    expect(await ipOf(app, { ...proxied, [PROXY_SECRET_HEADER]: SECRET })).toBe('203.0.113.7');
    // A direct caller forging x-mb-client-ip without the secret falls back to the edge header.
    expect(await ipOf(app, proxied)).toBe('198.51.100.1');
    expect(await ipOf(app, { ...proxied, [PROXY_SECRET_HEADER]: 'y'.repeat(43) })).toBe(
      '198.51.100.1',
    );
    expect(await ipOf(app, { ...proxied, [PROXY_SECRET_HEADER]: SECRET.slice(1) })).toBe(
      '198.51.100.1',
    );
  });

  it('never trusts x-mb-client-ip when no secret is configured', async () => {
    const app = appWith({ edgeHeader: 'cf-connecting-ip' });
    expect(
      await ipOf(app, {
        'cf-connecting-ip': '198.51.100.1',
        [PROXY_CLIENT_IP_HEADER]: '203.0.113.7',
        [PROXY_SECRET_HEADER]: '',
      }),
    ).toBe('198.51.100.1');
  });

  it('ignores values that are not IP addresses', async () => {
    const app = appWith({ edgeHeader: 'cf-connecting-ip', proxySecret: SECRET });
    expect(
      await ipOf(app, {
        'cf-connecting-ip': '198.51.100.1',
        [PROXY_CLIENT_IP_HEADER]: '203.0.113.7, 6.6.6.6',
        [PROXY_SECRET_HEADER]: SECRET,
      }),
    ).toBe('198.51.100.1');
    expect(await ipOf(app, { 'cf-connecting-ip': 'not-an-ip' })).toMatch(/127\.0\.0\.1|::1/);
    expect(await ipOf(app, { 'cf-connecting-ip': '2001:db8::7' })).toBe('2001:db8::7');
  });
});
