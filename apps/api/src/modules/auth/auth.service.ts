import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  type AuthSession,
  type AuthUser,
  permissionsFor,
  type registerSchema,
} from '@mandapambook/shared';
import type { z } from 'zod';
import { type Db, PG_ERROR, pgErrorCode } from '../../db/client.js';
import { emailTokens, otpChallenges, ownerProfiles, users } from '../../db/schema/index.js';
import type { RevocationStore } from '../../infra/revocation-store.js';
import { hmacSha256, numericCode, randomToken, safeEqual } from '../../lib/crypto.js';
import { HttpError, errors } from '../../http/errors.js';
import type { RateLimiters } from '../../http/middleware/rate-limit.js';
import type { AuditContext, AuditService } from '../audit/audit.service.js';
import type { EmailSender, SmsSender } from '../notifications/senders.js';
import type { AccessTokenService } from './access-tokens.js';
import {
  type BreachChecker,
  PASSWORD_POLICY_MESSAGES,
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  verifyAgainstDummy,
  verifyPassword,
} from './password.js';
import type { IssuedRefreshToken, RefreshTokenService } from './refresh-tokens.js';

type UserRow = typeof users.$inferSelect;

export interface AuthConfig {
  appBaseUrl: string;
  refreshTtlDays: number;
  refreshRememberDays: number;
  maxFailures: number;
  lockoutMinutes: number;
  otpSecret: Buffer;
}

export interface ClientContext extends AuditContext {
  deviceInfo?: string | null;
}

export interface LoginResult {
  session: AuthSession;
  refresh: IssuedRefreshToken;
}

const EMAIL_TOKEN_TTL = { VERIFY_EMAIL: 24 * 3600, PASSWORD_RESET: 30 * 60 } as const;
const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;
const DAY_MS = 86_400_000;

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: AuthConfig,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly revocations: RevocationStore,
    private readonly limiters: RateLimiters,
    private readonly audit: AuditService,
    private readonly email: EmailSender,
    private readonly sms: SmsSender,
    private readonly breaches: BreachChecker,
  ) {}

  // ---------------------------------------------------------------- register

  /**
   * Always answers the same way whether or not the email is registered, so the endpoint
   * cannot be used to discover accounts. An existing user gets a notice email instead.
   */
  async register(input: z.output<typeof registerSchema>, ctx: ClientContext): Promise<void> {
    await this.assertPasswordAllowed(input.password, input.email);
    const passwordHash = await hashPassword(input.password);

    let created: UserRow | undefined;
    try {
      created = await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            email: input.email,
            fullName: input.fullName,
            phone: input.phone ?? null,
            passwordHash,
            role: input.accountType,
            status: 'PENDING_VERIFICATION',
          })
          .returning();
        if (!user) throw new Error('user insert returned nothing');
        if (input.accountType === 'OWNER') {
          await tx.insert(ownerProfiles).values({ userId: user.id, businessName: input.fullName });
        }
        await this.audit.record(
          {
            action: 'auth.register',
            entityType: 'user',
            entityId: user.id,
            actorId: user.id,
            actorRole: user.role,
            after: { role: user.role },
          },
          ctx,
          tx,
        );
        return user;
      });
    } catch (err) {
      if (pgErrorCode(err) !== PG_ERROR.UNIQUE_VIOLATION) throw err;
    }

    if (created) {
      await this.sendEmailToken(created, 'VERIFY_EMAIL');
    } else {
      await this.email.send({
        to: input.email,
        template: 'account_exists',
        subject: 'You already have a MandapamBook account',
        text: `Someone tried to sign up with this email. If it was you, sign in or reset your password at ${this.config.appBaseUrl}/forgot-password. If not, you can ignore this email.`,
      });
    }
  }

  // ---------------------------------------------------------------- login

  async login(
    input: { email: string; password: string; rememberMe: boolean },
    ctx: ClientContext,
  ): Promise<LoginResult> {
    await this.limiters.consume('loginPerEmail', input.email);

    const [user] = await this.db.select().from(users).where(eq(users.email, input.email));
    if (!user?.passwordHash) {
      await verifyAgainstDummy(input.password);
      await this.audit.record(
        {
          action: 'auth.login_failed',
          entityType: 'user',
          success: false,
          after: { reason: 'unknown_email' },
        },
        ctx,
      );
      throw errors.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      // Same response as a rate limit, so a lockout does not confirm the account exists.
      throw errors.tooManyRequests((user.lockedUntil.getTime() - Date.now()) / 1000);
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.recordFailedLogin(user, ctx);
      throw errors.invalidCredentials();
    }

    if (user.status === 'SUSPENDED') {
      await this.audit.record(
        {
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user.id,
          actorId: user.id,
          success: false,
          after: { reason: 'suspended' },
        },
        ctx,
      );
      throw errors.forbidden('This account is suspended. Contact support.');
    }

    const rehash = needsRehash(user.passwordHash) ? await hashPassword(input.password) : null;
    await this.db
      .update(users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(rehash ? { passwordHash: rehash } : {}),
      })
      .where(eq(users.id, user.id));
    await this.limiters.reset('loginPerEmail', input.email);

    const days = input.rememberMe ? this.config.refreshRememberDays : this.config.refreshTtlDays;
    const refresh = await this.refreshTokens.issue(this.db, {
      userId: user.id,
      expiresAt: new Date(Date.now() + days * DAY_MS),
      deviceInfo: ctx.deviceInfo ?? null,
      ip: ctx.ip ?? null,
    });
    await this.audit.record(
      {
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        actorId: user.id,
        actorRole: user.role,
        after: { familyId: refresh.familyId },
      },
      ctx,
    );
    return { session: await this.sessionFor(user, refresh.familyId), refresh };
  }

  private async recordFailedLogin(user: UserRow, ctx: ClientContext): Promise<void> {
    const lockUntil = new Date(Date.now() + this.config.lockoutMinutes * 60_000);
    // Atomic increment; lock once the threshold is reached.
    const [updated] = await this.db
      .update(users)
      .set({
        failedLoginCount: sql`${users.failedLoginCount} + 1`,
        lockedUntil: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${this.config.maxFailures} THEN ${lockUntil.toISOString()}::timestamptz ELSE ${users.lockedUntil} END`,
      })
      .where(eq(users.id, user.id))
      .returning({ failedLoginCount: users.failedLoginCount, lockedUntil: users.lockedUntil });

    await this.audit.record(
      {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        success: false,
        after: { reason: 'bad_password', failures: updated?.failedLoginCount },
      },
      ctx,
    );
    if (updated && updated.failedLoginCount >= this.config.maxFailures) {
      // Reset the counter so the next window starts fresh after the lock expires.
      await this.db.update(users).set({ failedLoginCount: 0 }).where(eq(users.id, user.id));
      await this.audit.record(
        {
          action: 'auth.lockout',
          entityType: 'user',
          entityId: user.id,
          success: false,
          after: { lockedUntil: updated.lockedUntil },
        },
        ctx,
      );
      await this.email.send({
        to: user.email,
        template: 'security_alert',
        subject: 'Sign-in to your MandapamBook account was locked',
        text: `We locked sign-in for ${this.config.lockoutMinutes} minutes after several wrong passwords. If this wasn't you, reset your password at ${this.config.appBaseUrl}/forgot-password.`,
      });
    }
  }

  // ---------------------------------------------------------------- refresh / logout

  async refresh(token: string, ctx: ClientContext): Promise<LoginResult> {
    const result = await this.refreshTokens.rotate(this.db, token, {
      deviceInfo: ctx.deviceInfo ?? null,
      ip: ctx.ip ?? null,
    });
    if (result.kind === 'invalid') throw errors.unauthenticated('Your session has expired');
    if (result.kind === 'reused') {
      await this.revocations.revokeFamily(result.familyId, this.accessTokens.ttlSeconds);
      await this.audit.record(
        {
          action: 'auth.refresh_reuse',
          entityType: 'user',
          entityId: result.userId,
          success: false,
          after: { familyId: result.familyId },
        },
        ctx,
      );
      const [user] = await this.db.select().from(users).where(eq(users.id, result.userId));
      if (user) {
        await this.email.send({
          to: user.email,
          template: 'security_alert',
          subject: 'We signed out a MandapamBook session',
          text: 'An old sign-in token for your account was reused, which can mean it was copied. We signed that device out. If this keeps happening, change your password.',
        });
      }
      throw errors.unauthenticated('Your session has ended. Sign in again.');
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, result.userId));
    if (!user || user.status === 'SUSPENDED') {
      await this.refreshTokens.revokeFamily(this.db, result.issued.familyId, 'user_inactive');
      throw errors.unauthenticated();
    }
    return { session: await this.sessionFor(user, result.issued.familyId), refresh: result.issued };
  }

  async logout(
    input: { refreshToken?: string | undefined; accessJti?: string; accessExp?: number },
    ctx: ClientContext,
  ): Promise<void> {
    if (input.accessJti && input.accessExp) {
      await this.revocations.revokeToken(
        input.accessJti,
        input.accessExp - Math.floor(Date.now() / 1000),
      );
    }
    if (!input.refreshToken) return;
    const family = await this.refreshTokens.findFamily(this.db, input.refreshToken);
    if (!family) return;
    await this.refreshTokens.revokeFamily(this.db, family.familyId, 'logout');
    await this.revocations.revokeFamily(family.familyId, this.accessTokens.ttlSeconds);
    await this.audit.record(
      {
        action: 'auth.logout',
        entityType: 'user',
        entityId: family.userId,
        actorId: family.userId,
        after: { familyId: family.familyId },
      },
      ctx,
    );
  }

  /** Ends every session of the user, including outstanding access tokens. */
  async revokeAllSessions(userId: string, reason: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(this.db, userId, reason);
    await this.revocations.setUserCutoff(userId, Date.now(), this.accessTokens.ttlSeconds);
  }

  async logoutAll(userId: string, ctx: ClientContext): Promise<void> {
    await this.revokeAllSessions(userId, 'logout_all');
    await this.audit.record(
      { action: 'auth.logout_all', entityType: 'user', entityId: userId, actorId: userId },
      ctx,
    );
  }

  async listSessions(userId: string, currentFamilyId: string) {
    const rows = await this.refreshTokens.listActive(this.db, userId);
    return rows.map((r) => ({ ...r, current: r.familyId === currentFamilyId }));
  }

  async revokeSession(userId: string, familyId: string, ctx: ClientContext): Promise<void> {
    const sessions = await this.refreshTokens.listActive(this.db, userId);
    if (!sessions.some((s) => s.familyId === familyId)) throw errors.notFound('Session not found');
    await this.refreshTokens.revokeFamily(this.db, familyId, 'revoked_by_user');
    await this.revocations.revokeFamily(familyId, this.accessTokens.ttlSeconds);
    await this.audit.record(
      {
        action: 'auth.session_revoked',
        entityType: 'user',
        entityId: userId,
        actorId: userId,
        after: { familyId },
      },
      ctx,
    );
  }

  // ---------------------------------------------------------------- email tokens

  async verifyEmail(token: string, ctx: ClientContext): Promise<void> {
    const row = await this.consumeEmailToken(token, 'VERIFY_EMAIL');
    await this.db
      .update(users)
      .set({
        emailVerifiedAt: new Date(),
        status: sql`CASE WHEN ${users.status} = 'PENDING_VERIFICATION' THEN 'ACTIVE'::user_status ELSE ${users.status} END`,
      })
      .where(eq(users.id, row.userId));
    await this.audit.record(
      {
        action: 'auth.email_verified',
        entityType: 'user',
        entityId: row.userId,
        actorId: row.userId,
      },
      ctx,
    );
  }

  /** Always succeeds from the caller's view; only sends mail if the account exists. */
  async requestPasswordReset(email: string, ctx: ClientContext): Promise<void> {
    await this.limiters.consume('passwordResetPerEmail', email);
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (!user || user.status === 'SUSPENDED') return;
    await this.sendEmailToken(user, 'PASSWORD_RESET');
    await this.audit.record(
      { action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id },
      ctx,
    );
  }

  async resetPassword(token: string, password: string, ctx: ClientContext): Promise<void> {
    const tokenHash = hmacSha256(this.config.otpSecret, token);
    const [pending] = await this.db
      .select({ userId: emailTokens.userId, email: users.email })
      .from(emailTokens)
      .innerJoin(users, eq(users.id, emailTokens.userId))
      .where(eq(emailTokens.tokenHash, tokenHash));
    if (pending) await this.assertPasswordAllowed(password, pending.email);

    const row = await this.consumeEmailToken(token, 'PASSWORD_RESET');
    await this.db
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        failedLoginCount: 0,
        lockedUntil: null,
        // Opening the emailed link proves the user controls the address.
        emailVerifiedAt: sql`COALESCE(${users.emailVerifiedAt}, now())`,
        status: sql`CASE WHEN ${users.status} = 'PENDING_VERIFICATION' THEN 'ACTIVE'::user_status ELSE ${users.status} END`,
      })
      .where(eq(users.id, row.userId));
    await this.revokeAllSessions(row.userId, 'password_reset');
    await this.audit.record(
      {
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: row.userId,
        actorId: row.userId,
      },
      ctx,
    );
  }

  /** Invited accounts (e.g. owner staff) choose their password through the reset flow. */
  async sendSetPasswordEmail(userId: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (user) await this.sendEmailToken(user, 'PASSWORD_RESET');
  }

  private async sendEmailToken(
    user: UserRow,
    purpose: 'VERIFY_EMAIL' | 'PASSWORD_RESET',
  ): Promise<void> {
    const token = randomToken(32);
    await this.db.insert(emailTokens).values({
      userId: user.id,
      purpose,
      tokenHash: hmacSha256(this.config.otpSecret, token),
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL[purpose] * 1000),
    });
    const verify = purpose === 'VERIFY_EMAIL';
    const link = `${this.config.appBaseUrl}/${verify ? 'verify-email' : 'reset-password'}?token=${token}`;
    await this.email.send({
      to: user.email,
      template: verify ? 'verify_email' : 'password_reset',
      subject: verify ? 'Verify your MandapamBook email' : 'Reset your MandapamBook password',
      text: verify
        ? `Hi ${user.fullName}, confirm your email by opening ${link} within 24 hours.`
        : `Reset your password by opening ${link} within 30 minutes. If you didn't ask for this, ignore this email.`,
    });
  }

  private async consumeEmailToken(token: string, purpose: 'VERIFY_EMAIL' | 'PASSWORD_RESET') {
    const tokenHash = hmacSha256(this.config.otpSecret, token);
    // Single atomic statement: a token can be used once, before it expires.
    const [row] = await this.db
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailTokens.tokenHash, tokenHash),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: emailTokens.userId });
    if (!row)
      throw errors.badRequest(
        'TOKEN_INVALID',
        'This link is invalid or has expired. Request a new one.',
      );
    return row;
  }

  // ---------------------------------------------------------------- phone OTP

  async sendPhoneOtp(userId: string, phone: string): Promise<void> {
    await this.limiters.consume('otpSendPerUser', userId);
    await this.limiters.consume('otpSendPerPhone', phone);
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, phone), sql`${users.id} <> ${userId}`));
    if (taken) throw errors.conflict('PHONE_IN_USE', 'This number is linked to another account');

    const code = numericCode(6);
    await this.db.insert(otpChallenges).values({
      userId,
      phone,
      purpose: 'PHONE_VERIFY',
      codeHash: hmacSha256(this.config.otpSecret, `${phone}:${code}`),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    });
    await this.sms.send({
      to: phone,
      text: `${code} is your MandapamBook verification code. It expires in 5 minutes. Do not share it.`,
    });
  }

  async verifyPhoneOtp(
    userId: string,
    phone: string,
    code: string,
    ctx: ClientContext,
  ): Promise<void> {
    await this.limiters.consume('otpVerifyPerUser', userId);
    const [challenge] = await this.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.userId, userId),
          eq(otpChallenges.phone, phone),
          eq(otpChallenges.purpose, 'PHONE_VERIFY'),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    const invalid = errors.badRequest('OTP_INVALID', 'The code is incorrect or has expired');
    if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) throw invalid;

    const expected = hmacSha256(this.config.otpSecret, `${phone}:${code}`);
    if (!safeEqual(expected, challenge.codeHash)) {
      await this.db
        .update(otpChallenges)
        .set({ attempts: sql`${otpChallenges.attempts} + 1` })
        .where(eq(otpChallenges.id, challenge.id));
      throw invalid;
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(otpChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(otpChallenges.id, challenge.id));
      await tx
        .update(users)
        .set({ phone, phoneVerifiedAt: new Date() })
        .where(eq(users.id, userId));
      await this.audit.record(
        { action: 'auth.phone_verified', entityType: 'user', entityId: userId, actorId: userId },
        ctx,
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- helpers

  async me(userId: string): Promise<AuthUser> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw errors.unauthenticated();
    return toAuthUser(user);
  }

  private async sessionFor(user: UserRow, familyId: string): Promise<AuthSession> {
    const { token } = await this.accessTokens.sign({ userId: user.id, role: user.role, familyId });
    return { accessToken: token, expiresIn: this.accessTokens.ttlSeconds, user: toAuthUser(user) };
  }

  private async assertPasswordAllowed(password: string, email: string): Promise<void> {
    const result = await checkPasswordPolicy(password, email, this.breaches);
    if (!result.ok && result.reason) {
      throw new HttpError(400, 'WEAK_PASSWORD', PASSWORD_POLICY_MESSAGES[result.reason]);
    }
  }
}

export function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    phoneVerified: user.phoneVerifiedAt !== null,
    permissions: permissionsFor(user.role),
  };
}
