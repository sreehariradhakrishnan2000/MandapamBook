import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@mandapambook/shared';

/** OWASP-recommended argon2id parameters (64 MiB, 3 passes, 1 lane). */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;
/**
 * Spend the same time as a real verification when the account does not exist,
 * so response timing does not reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  await verifyPassword(await dummyHash, password);
  return false;
}

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: 'TOO_SHORT' | 'TOO_LONG' | 'CONTAINS_EMAIL' | 'BREACHED';
}

export interface BreachChecker {
  /** Resolves true if the password appears in a known breach corpus. */
  isBreached(password: string): Promise<boolean>;
}

/**
 * Have I Been Pwned range API: only the first 5 hex chars of the SHA-1 are sent.
 * Fails open (returns false) if the service is slow or unavailable.
 */
export class HibpBreachChecker implements BreachChecker {
  constructor(private readonly timeoutMs = 1500) {}

  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'mandapambook-api' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return false;
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [hashSuffix, count] = line.trim().split(':');
        return hashSuffix === suffix && Number(count) > 0;
      });
    } catch {
      return false;
    }
  }
}

export const noBreachCheck: BreachChecker = { isBreached: async () => false };

export async function checkPasswordPolicy(
  password: string,
  email: string,
  breaches: BreachChecker,
): Promise<PasswordPolicyResult> {
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'TOO_SHORT' };
  if (password.length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    return { ok: false, reason: 'CONTAINS_EMAIL' };
  }
  if (await breaches.isBreached(password)) return { ok: false, reason: 'BREACHED' };
  return { ok: true };
}

export const PASSWORD_POLICY_MESSAGES: Record<
  NonNullable<PasswordPolicyResult['reason']>,
  string
> = {
  TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  TOO_LONG: `Use at most ${PASSWORD_MAX_LENGTH} characters`,
  CONTAINS_EMAIL: 'Do not include your email address in the password',
  BREACHED: 'This password has appeared in a data breach. Choose a different one.',
};
