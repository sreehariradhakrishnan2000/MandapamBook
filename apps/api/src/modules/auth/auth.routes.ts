import { type CookieOptions, type Request, type Response, Router } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  otpSendSchema,
  otpVerifySchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@mandapambook/shared';
import { z } from 'zod';
import type { RequestHandler } from 'express';
import { type RateLimiters, byIp } from '../../http/middleware/rate-limit.js';
import { auditContext } from '../audit/audit.service.js';
import { currentUser } from '../rbac/authenticate.js';
import type { AuthService, ClientContext, LoginResult } from './auth.service.js';

export const REFRESH_COOKIE = '__Host-mb_rt';

/**
 * `__Host-` forces Secure, Path=/ and no Domain, so the cookie is bound to this exact
 * origin. httpOnly keeps it from scripts; SameSite=Strict keeps it off cross-site requests.
 * Browsers accept Secure cookies on http://localhost, so this works in development too.
 */
function refreshCookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

function clientContext(req: Request): ClientContext {
  return { ...auditContext(req), deviceInfo: req.get('user-agent')?.slice(0, 255) ?? null };
}

function sendSession(res: Response, result: LoginResult): void {
  res.cookie(REFRESH_COOKIE, result.refresh.token, refreshCookieOptions(result.refresh.expiresAt));
  res.set('Cache-Control', 'no-store').json(result.session);
}

function refreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length <= 200 ? value : undefined;
}

export interface AuthRouterDeps {
  auth: AuthService;
  limiters: RateLimiters;
  authenticate: RequestHandler;
  csrf: { issue: RequestHandler; verify: RequestHandler };
}

export function authRouter({ auth, limiters, authenticate, csrf }: AuthRouterDeps): Router {
  const r = Router();
  const accepted = {
    message: 'If the details are valid, we have sent you an email with next steps.',
  };

  r.get('/csrf', csrf.issue);

  r.post('/register', limiters.middleware('registerPerIp', byIp), async (req, res) => {
    await auth.register(registerSchema.parse(req.body), clientContext(req));
    res.status(202).json(accepted);
  });

  r.post('/login', limiters.middleware('loginPerIp', byIp), async (req, res) => {
    const input = loginSchema.parse(req.body);
    sendSession(res, await auth.login(input, clientContext(req)));
  });

  // Cookie-authenticated endpoints: CSRF-protected.
  r.post('/refresh', limiters.middleware('refreshPerIp', byIp), csrf.verify, async (req, res) => {
    const token = refreshCookie(req);
    if (!token) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sign in to continue',
          correlationId: String(req.id),
        },
      });
      return;
    }
    try {
      sendSession(res, await auth.refresh(token, clientContext(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw err;
    }
  });

  r.post('/logout', csrf.verify, async (req, res) => {
    // A Bearer token is optional here; if present and valid, deny it immediately too.
    const bearer = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
    let access: { accessJti?: string; accessExp?: number } = {};
    if (bearer) {
      await new Promise<void>((resolve) => authenticate(req, res, () => resolve()));
      if (req.auth) access = { accessJti: req.auth.jti, accessExp: req.auth.expiresAt };
    }
    await auth.logout({ refreshToken: refreshCookie(req), ...access }, clientContext(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.status(204).end();
  });

  r.post('/verify-email', async (req, res) => {
    const { token } = verifyEmailSchema.parse(req.body);
    await auth.verifyEmail(token, clientContext(req));
    res.json({ message: 'Your email is verified.' });
  });

  r.post('/password/forgot', limiters.middleware('passwordResetPerIp', byIp), async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    await auth.requestPasswordReset(email, clientContext(req));
    res.status(202).json(accepted);
  });

  r.post('/password/reset', limiters.middleware('passwordResetPerIp', byIp), async (req, res) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await auth.resetPassword(token, password, clientContext(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.json({ message: 'Your password has been changed. Sign in with your new password.' });
  });

  // Bearer-authenticated endpoints (not cookie-based, so not CSRF-exposed).
  r.get('/me', authenticate, async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await auth.me(currentUser(req).userId));
  });

  r.post('/logout-all', authenticate, async (req, res) => {
    await auth.logoutAll(currentUser(req).userId, clientContext(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.status(204).end();
  });

  r.get('/sessions', authenticate, async (req, res) => {
    const me = currentUser(req);
    res
      .set('Cache-Control', 'no-store')
      .json({ sessions: await auth.listSessions(me.userId, me.familyId) });
  });

  r.delete('/sessions/:familyId', authenticate, async (req, res) => {
    const familyId = z.uuid().parse(req.params['familyId']);
    await auth.revokeSession(currentUser(req).userId, familyId, clientContext(req));
    res.status(204).end();
  });

  r.post('/otp/send', authenticate, async (req, res) => {
    const { phone } = otpSendSchema.parse(req.body);
    await auth.sendPhoneOtp(currentUser(req).userId, phone);
    res.status(202).json({ message: 'We sent a 6-digit code to your phone.' });
  });

  r.post('/otp/verify', authenticate, async (req, res) => {
    const { phone, code } = otpVerifySchema.parse(req.body);
    await auth.verifyPhoneOtp(currentUser(req).userId, phone, code, clientContext(req));
    res.json({ message: 'Your phone number is verified.' });
  });

  return r;
}
