import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { safeEqual } from '../../lib/crypto.js';

/** Sent by our own web proxy (nginx): the browser's IP, and proof the request came from it. */
export const PROXY_CLIENT_IP_HEADER = 'x-mb-client-ip';
export const PROXY_SECRET_HEADER = 'x-mb-proxy-secret';

/**
 * Resolves the real client IP, which keys rate limits and is written to audit logs.
 *
 * Counting X-Forwarded-For hops can't be both correct and safe when the API is reachable
 * by paths of different lengths (directly, and through the web app's proxy): a count that
 * fits the long path lets direct callers forge their IP. Instead, in order:
 *  1. `x-mb-client-ip` from our own web proxy, trusted only with the shared secret
 *     (constant-time compare), so no other caller can set it;
 *  2. the edge's client-IP header (e.g. Render/Cloudflare `cf-connecting-ip`, which the
 *     edge overwrites and refuses to accept from clients);
 *  3. otherwise Express's `req.ip` (TRUST_PROXY_HOPS), as before: local, CI, tests.
 * Values that aren't IP addresses are ignored.
 */
export function clientIp(opts: {
  edgeHeader?: string | undefined;
  proxySecret?: string | undefined;
}): RequestHandler {
  const edgeHeader = opts.edgeHeader?.toLowerCase();
  const secret = opts.proxySecret ? opts.proxySecret : undefined;

  return (req, _res, next) => {
    let ip: string | undefined;
    const presented = req.get(PROXY_SECRET_HEADER);
    if (secret && presented && safeEqual(presented, secret)) {
      ip = valid(req.get(PROXY_CLIENT_IP_HEADER));
    }
    if (!ip && edgeHeader) ip = valid(req.get(edgeHeader));
    if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
    next();
  };
}

function valid(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && isIP(v) ? v : undefined;
}
