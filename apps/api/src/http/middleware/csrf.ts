import type { CookieOptions, RequestHandler } from 'express';
import { hmacSha256, randomToken, safeEqual } from '../../lib/crypto.js';
import { errors } from '../errors.js';

export const CSRF_COOKIE = '__Host-mb_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
};

/**
 * Signed double-submit CSRF protection for the endpoints that rely on the refresh cookie.
 * The token is "<random>.<hmac(random)>": the client echoes it in X-CSRF-Token, and the
 * server checks it matches the cookie and carries a valid signature (so an attacker who
 * can plant cookies on a sibling domain still cannot forge one). Origin is checked too.
 */
export function createCsrf(
  secret: Buffer,
  allowedOrigins: string[],
): { issue: RequestHandler; verify: RequestHandler } {
  const sign = (nonce: string) => hmacSha256(secret, nonce).toString('base64url');
  const allowed = new Set(allowedOrigins);

  const issue: RequestHandler = (_req, res) => {
    const nonce = randomToken(24);
    const token = `${nonce}.${sign(nonce)}`;
    res.cookie(CSRF_COOKIE, token, cookieOptions);
    res.set('Cache-Control', 'no-store').json({ csrfToken: token });
  };

  const verify: RequestHandler = (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) return next(errors.csrf());

    const header = req.get(CSRF_HEADER);
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    if (!header || typeof cookie !== 'string' || !safeEqual(header, cookie)) {
      return next(errors.csrf());
    }
    const [nonce, signature] = header.split('.');
    if (!nonce || !signature || !safeEqual(signature, sign(nonce))) return next(errors.csrf());
    next();
  };

  return { issue, verify };
}
