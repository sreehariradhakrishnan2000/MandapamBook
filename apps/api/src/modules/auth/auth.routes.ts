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
import {
  type AuthService,
  type ClientContext,
  GoogleSignInError,
  type LoginResult,
} from './auth.service.js';
import {
  type GoogleProvider,
  type OAuthState,
  openState,
  pkceChallenge,
  randomValue,
  safeEqual,
  safeReturnPath,
  sealState,
} from './google.js';

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
  /** Public URL of the web app: Google returns there, and users land there afterwards. */
  appBaseUrl: string;
  /** Present only when Google sign-in is configured. */
  google?: { provider: GoogleProvider; stateKey: Buffer };
}

/**
 * A path on our own site to return to after verifying, e.g. the booking page the customer
 * was on. Path only: no scheme, no host, no "//" or backslash, so it can't send anyone away.
 */
export const SAFE_RETURN_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?&=%+]*$/;

const resendVerificationSchema = z.strictObject({
  returnTo: z.string().max(300).regex(SAFE_RETURN_PATH).optional(),
});

/** Carries the OAuth state, PKCE verifier and nonce from /google/start to the callback. */
export const GOOGLE_STATE_COOKIE = '__Host-mb_oauth';
const GOOGLE_STATE_TTL_MS = 10 * 60_000;

/** Lax, not Strict: the callback is a top-level navigation coming back from Google. */
function googleStateCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
}

export function authRouter({
  auth,
  limiters,
  authenticate,
  csrf,
  appBaseUrl,
  google,
}: AuthRouterDeps): Router {
  const r = Router();
  const accepted = {
    message: 'If the details are valid, we have sent you an email with next steps.',
  };
  const webBase = appBaseUrl.replace(/\/+$/, '');
  const googleRedirectUri = `${webBase}/api/v1/auth/google/callback`;

  r.get('/csrf', csrf.issue);

  /** Which sign-in options the web app should offer. */
  r.get('/providers', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ google: Boolean(google) });
  });

  r.get('/google/start', limiters.middleware('loginPerIp', byIp), (req, res) => {
    if (!google) {
      res.redirect(303, `${webBase}/login?error=google_unavailable`);
      return;
    }
    const codeVerifier = randomValue(48);
    const state: OAuthState = {
      state: randomValue(),
      codeVerifier,
      nonce: randomValue(),
      intent: req.query['intent'] === 'owner' ? 'OWNER' : 'CUSTOMER',
      returnUrl: safeReturnPath(req.query['returnUrl']),
      expiresAt: Date.now() + GOOGLE_STATE_TTL_MS,
    };
    // Flags spelled out (not spread from a helper) so they are visible to code scanning.
    res.cookie(GOOGLE_STATE_COOKIE, sealState(google.stateKey, state), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: GOOGLE_STATE_TTL_MS,
    });
    res.set('Cache-Control', 'no-store').redirect(
      302,
      google.provider.authorizationUrl({
        state: state.state,
        nonce: state.nonce,
        codeChallenge: pkceChallenge(codeVerifier),
        redirectUri: googleRedirectUri,
      }),
    );
  });

  r.get('/google/callback', limiters.middleware('loginPerIp', byIp), async (req, res) => {
    const fail = (reason: string): void => {
      res.set('Cache-Control', 'no-store').redirect(303, `${webBase}/login?error=google_${reason}`);
    };
    const cookie: unknown = req.cookies?.[GOOGLE_STATE_COOKIE];
    res.clearCookie(GOOGLE_STATE_COOKIE, googleStateCookieOptions()); // one use only
    if (!google) return fail('unavailable');
    if (typeof req.query['error'] === 'string') {
      return fail(req.query['error'] === 'access_denied' ? 'cancelled' : 'failed');
    }
    const saved = openState(google.stateKey, typeof cookie === 'string' ? cookie : undefined);
    const { code, state } = req.query;
    if (
      !saved ||
      typeof state !== 'string' ||
      !safeEqual(state, saved.state) ||
      typeof code !== 'string' ||
      !code ||
      code.length > 2000
    ) {
      return fail('expired');
    }

    let profile;
    try {
      profile = await google.provider.exchange({
        code,
        codeVerifier: saved.codeVerifier,
        nonce: saved.nonce,
        redirectUri: googleRedirectUri,
      });
    } catch (err) {
      req.log.warn({ err }, 'google sign-in: code exchange failed');
      return fail('failed');
    }

    let result: LoginResult;
    try {
      result = await auth.signInWithGoogle(profile, saved.intent, clientContext(req));
    } catch (err) {
      if (err instanceof GoogleSignInError) return fail(err.code);
      throw err;
    }
    // The web app restores the session from this cookie as soon as the page loads.
    res.cookie(
      REFRESH_COOKIE,
      result.refresh.token,
      refreshCookieOptions(result.refresh.expiresAt),
    );
    res.set('Cache-Control', 'no-store').redirect(303, `${webBase}${saved.returnUrl}`);
  });

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

  r.post('/verify-email', limiters.middleware('verifyEmailPerIp', byIp), async (req, res) => {
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

  r.post('/verify-email/resend', authenticate, async (req, res) => {
    const { returnTo } = resendVerificationSchema.parse(req.body ?? {});
    await auth.resendVerificationEmail(currentUser(req).userId, clientContext(req), returnTo);
    res.status(202).json({ message: 'We sent a new verification link to your email.' });
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
