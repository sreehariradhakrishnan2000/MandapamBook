import { randomUUID } from 'node:crypto';
import {
  type JWTPayload,
  SignJWT,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
} from 'jose';
import { ROLES, type Role } from '@mandapambook/shared';
import type { KeyRingEntry } from '../../config/env.js';

export const ISSUER = 'mandapambook';
export const AUDIENCE = 'mandapambook-api';

export interface AccessClaims {
  userId: string;
  role: Role;
  /** Refresh-token family (device session) this access token belongs to. */
  familyId: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

export class AccessTokenError extends Error {
  override name = 'AccessTokenError';
  constructor(readonly reason: 'expired' | 'invalid') {
    super(`access token ${reason}`);
  }
}

/**
 * HS256 access tokens signed with the first key in the ring. The `kid` header selects
 * the verification key, so keys can be rotated without logging everyone out.
 */
export class AccessTokenService {
  private readonly keys: Map<string, Buffer>;
  private readonly signer: KeyRingEntry;

  constructor(
    ring: KeyRingEntry[],
    readonly ttlSeconds: number,
  ) {
    const [signer] = ring;
    if (!signer) throw new Error('access token key ring is empty');
    this.signer = signer;
    this.keys = new Map(ring.map((k) => [k.kid, k.secret]));
  }

  async sign(input: { userId: string; role: Role; familyId: string }): Promise<{
    token: string;
    claims: AccessClaims;
  }> {
    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: input.role, sid: input.familyId })
      .setProtectedHeader({ alg: 'HS256', kid: this.signer.kid, typ: 'at+jwt' })
      .setSubject(input.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setJti(jti)
      .setIssuedAt(now)
      .setExpirationTime(now + this.ttlSeconds)
      .sign(this.signer.secret);
    return {
      token,
      claims: { ...input, jti, issuedAt: now, expiresAt: now + this.ttlSeconds },
    };
  }

  async verify(token: string): Promise<AccessClaims> {
    let kid: string | undefined;
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'HS256' || header.typ !== 'at+jwt') throw new AccessTokenError('invalid');
      kid = header.kid;
    } catch {
      throw new AccessTokenError('invalid');
    }
    const key = kid ? this.keys.get(kid) : undefined;
    if (!key) throw new AccessTokenError('invalid');

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        typ: 'at+jwt',
        requiredClaims: ['sub', 'jti', 'iat', 'exp'],
      }));
    } catch (err) {
      throw new AccessTokenError(err instanceof joseErrors.JWTExpired ? 'expired' : 'invalid');
    }
    const role = payload['role'];
    const sid = payload['sid'];
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof sid !== 'string' ||
      typeof role !== 'string' ||
      !(ROLES as readonly string[]).includes(role)
    ) {
      throw new AccessTokenError('invalid');
    }
    return {
      userId: payload.sub,
      role: role as Role,
      familyId: sid,
      jti: payload.jti,
      issuedAt: payload.iat ?? 0,
      expiresAt: payload.exp ?? 0,
    };
  }
}
