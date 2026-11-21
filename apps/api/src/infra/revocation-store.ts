import type { Redis } from 'ioredis';

/**
 * Short-lived revocation state for access tokens, which are otherwise stateless.
 * Entries only need to live as long as an access token can (≤ 1 hour).
 */
export interface RevocationStore {
  /** Deny one access token (by jti) until it would have expired anyway. */
  revokeToken(jti: string, ttlSeconds: number): Promise<void>;
  isTokenRevoked(jti: string): Promise<boolean>;
  /** Deny every access token issued for a refresh-token family (one device session). */
  revokeFamily(familyId: string, ttlSeconds: number): Promise<void>;
  isFamilyRevoked(familyId: string): Promise<boolean>;
  /** Deny every access token for a user issued before `epochSeconds` (logout-all, role change). */
  setUserCutoff(userId: string, epochSeconds: number, ttlSeconds: number): Promise<void>;
  getUserCutoff(userId: string): Promise<number | null>;
}

const k = {
  jti: (jti: string) => `auth:revoked:jti:${jti}`,
  family: (id: string) => `auth:revoked:family:${id}`,
  cutoff: (id: string) => `auth:cutoff:user:${id}`,
};

export class RedisRevocationStore implements RevocationStore {
  constructor(private readonly redis: Redis) {}

  async revokeToken(jti: string, ttl: number): Promise<void> {
    await this.redis.set(k.jti(jti), '1', 'EX', Math.max(1, ttl));
  }
  async isTokenRevoked(jti: string): Promise<boolean> {
    return (await this.redis.exists(k.jti(jti))) === 1;
  }
  async revokeFamily(id: string, ttl: number): Promise<void> {
    await this.redis.set(k.family(id), '1', 'EX', Math.max(1, ttl));
  }
  async isFamilyRevoked(id: string): Promise<boolean> {
    return (await this.redis.exists(k.family(id))) === 1;
  }
  async setUserCutoff(userId: string, epochSeconds: number, ttl: number): Promise<void> {
    await this.redis.set(k.cutoff(userId), String(epochSeconds), 'EX', Math.max(1, ttl));
  }
  async getUserCutoff(userId: string): Promise<number | null> {
    const v = await this.redis.get(k.cutoff(userId));
    return v === null ? null : Number(v);
  }
}

/** In-process store for tests and single-process development without Redis. */
export class MemoryRevocationStore implements RevocationStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  private set(key: string, value: string, ttl: number): void {
    this.entries.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }
  private get(key: string): string | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return e.value;
  }

  async revokeToken(jti: string, ttl: number): Promise<void> {
    this.set(k.jti(jti), '1', ttl);
  }
  async isTokenRevoked(jti: string): Promise<boolean> {
    return this.get(k.jti(jti)) !== null;
  }
  async revokeFamily(id: string, ttl: number): Promise<void> {
    this.set(k.family(id), '1', ttl);
  }
  async isFamilyRevoked(id: string): Promise<boolean> {
    return this.get(k.family(id)) !== null;
  }
  async setUserCutoff(userId: string, epochSeconds: number, ttl: number): Promise<void> {
    this.set(k.cutoff(userId), String(epochSeconds), ttl);
  }
  async getUserCutoff(userId: string): Promise<number | null> {
    const v = this.get(k.cutoff(userId));
    return v === null ? null : Number(v);
  }
}
