import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type Permission, hasPermission } from '@mandapambook/shared';
import type { RevocationStore } from '../../infra/revocation-store.js';
import { errors } from '../../http/errors.js';
import {
  type AccessClaims,
  AccessTokenError,
  type AccessTokenService,
} from '../auth/access-tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented augmentation point
  namespace Express {
    interface Request {
      /** Set by `authenticate` once the access token has been verified. */
      auth?: AccessClaims;
    }
  }
}

/** Returns the verified caller or throws 401; use inside handlers behind `authenticate`. */
export function currentUser(req: Request): AccessClaims {
  if (!req.auth) throw errors.unauthenticated();
  return req.auth;
}

export function createAuthenticate(
  tokens: AccessTokenService,
  revocations: RevocationStore,
): RequestHandler {
  /**
   * Verifies the Bearer access token and that it has not been revoked individually
   * (logout), by session (refresh reuse, session revoke) or for the whole user
   * (logout-all, role change, suspension).
   */
  const authenticate: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get('authorization');
    const match = header ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
    if (!match?.[1]) return next(errors.unauthenticated());

    tokens
      .verify(match[1])
      .then(async (claims) => {
        const [tokenRevoked, familyRevoked, cutoff] = await Promise.all([
          revocations.isTokenRevoked(claims.jti),
          revocations.isFamilyRevoked(claims.familyId),
          revocations.getUserCutoff(claims.userId),
        ]);
        if (tokenRevoked || familyRevoked || (cutoff !== null && claims.issuedAt <= cutoff)) {
          throw errors.unauthenticated('Your session has ended. Sign in again.');
        }
        req.auth = claims;
        next();
      })
      .catch((err: unknown) => {
        if (err instanceof AccessTokenError) {
          return next(
            err.reason === 'expired'
              ? errors.unauthenticated('Your session has expired')
              : errors.unauthenticated(),
          );
        }
        next(err);
      });
  };
  return authenticate;
}

/** Allows the request only if the caller's role grants every listed permission. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(errors.unauthenticated());
    if (!permissions.every((p) => hasPermission(auth.role, p))) return next(errors.forbidden());
    next();
  };
}
