import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { KeyRingEntry } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { refreshTokens } from '../../db/schema/index.js';
import { hmacSha256, randomToken } from '../../lib/crypto.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Executor = Db | Tx;

export interface IssuedRefreshToken {
  /** Opaque value for the cookie: "<kid>.<random>". Never stored. */
  token: string;
  id: string;
  familyId: string;
  expiresAt: Date;
}

export type RotationResult =
  | { kind: 'rotated'; userId: string; issued: IssuedRefreshToken }
  | { kind: 'reused'; userId: string; familyId: string }
  | { kind: 'invalid' };

/**
 * Opaque refresh tokens, stored only as HMAC-SHA256 hashes. Each use rotates the token
 * within its family; presenting an already-rotated token means it was stolen or replayed,
 * so the whole family (device session) is revoked.
 */
export class RefreshTokenService {
  private readonly keys: Map<string, Buffer>;
  private readonly signer: KeyRingEntry;

  constructor(ring: KeyRingEntry[]) {
    const [signer] = ring;
    if (!signer) throw new Error('refresh token key ring is empty');
    this.signer = signer;
    this.keys = new Map(ring.map((k) => [k.kid, k.secret]));
  }

  /** Returns the stored hash for a presented token, or null if it is malformed. */
  hash(token: string): Buffer | null {
    const dot = token.indexOf('.');
    if (dot < 1 || token.length > 200) return null;
    const key = this.keys.get(token.slice(0, dot));
    return key ? hmacSha256(key, token) : null;
  }

  async issue(
    db: Executor,
    input: {
      userId: string;
      familyId?: string;
      expiresAt: Date;
      deviceInfo?: string | null;
      ip?: string | null;
    },
  ): Promise<IssuedRefreshToken> {
    const token = `${this.signer.kid}.${randomToken(32)}`;
    const familyId = input.familyId ?? randomUUID();
    const [row] = await db
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        familyId,
        tokenHash: hmacSha256(this.signer.secret, token),
        expiresAt: input.expiresAt,
        deviceInfo: input.deviceInfo?.slice(0, 255) ?? null,
        ip: input.ip ?? null,
      })
      .returning({ id: refreshTokens.id });
    if (!row) throw new Error('failed to store refresh token');
    return { token, id: row.id, familyId, expiresAt: input.expiresAt };
  }

  async rotate(
    db: Db,
    token: string,
    context: { deviceInfo?: string | null; ip?: string | null },
  ): Promise<RotationResult> {
    const tokenHash = this.hash(token);
    if (!tokenHash) return { kind: 'invalid' };

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .for('update');
      if (!current) return { kind: 'invalid' } as const;

      if (current.revokedAt) {
        // Reuse of a rotated or revoked token: treat the whole family as compromised.
        await this.revokeFamily(tx, current.familyId, 'reuse_detected');
        return { kind: 'reused', userId: current.userId, familyId: current.familyId } as const;
      }
      if (current.expiresAt.getTime() <= Date.now()) return { kind: 'invalid' } as const;

      // The family keeps its original absolute expiry; rotation does not extend a session.
      const issued = await this.issue(tx, {
        userId: current.userId,
        familyId: current.familyId,
        expiresAt: current.expiresAt,
        deviceInfo: context.deviceInfo ?? current.deviceInfo,
        ip: context.ip ?? current.ip,
      });
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: 'rotated', replacedBy: issued.id })
        .where(eq(refreshTokens.id, current.id));
      return { kind: 'rotated', userId: current.userId, issued } as const;
    });
  }

  /** Looks up the family of a presented token without rotating it (used by logout). */
  async findFamily(
    db: Executor,
    token: string,
  ): Promise<{ familyId: string; userId: string } | null> {
    const tokenHash = this.hash(token);
    if (!tokenHash) return null;
    const [row] = await db
      .select({ familyId: refreshTokens.familyId, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return row ?? null;
  }

  async revokeFamily(db: Executor, familyId: string, reason: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(db: Executor, userId: string, reason: string): Promise<string[]> {
    const rows = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .returning({ familyId: refreshTokens.familyId });
    return [...new Set(rows.map((r) => r.familyId))];
  }

  /** Active sessions: the current (unrevoked, unexpired) token of each family. */
  async listActive(db: Executor, userId: string) {
    return db
      .select({
        familyId: refreshTokens.familyId,
        deviceInfo: refreshTokens.deviceInfo,
        ip: refreshTokens.ip,
        lastUsedAt: refreshTokens.createdAt,
        expiresAt: refreshTokens.expiresAt,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      );
  }
}
