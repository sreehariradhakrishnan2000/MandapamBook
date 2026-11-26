import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { AuthSession, AuthUser, Permission } from '@mandapambook/shared';
import { firstValueFrom } from 'rxjs';

export const API = '/api/v1';

interface CsrfResponse {
  csrfToken: string;
}

export interface SessionInfo {
  familyId: string;
  deviceInfo: string | null;
  ip: string | null;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

/**
 * Holds the access token in memory only (never localStorage), so an XSS bug cannot read
 * a long-lived credential. The refresh token lives in an httpOnly cookie the app never sees.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly session = signal<AuthSession | null>(null);
  private refreshInFlight: Promise<boolean> | null = null;
  private csrfToken: string | null = null;

  readonly user = computed<AuthUser | null>(() => this.session()?.user ?? null);
  readonly isSignedIn = computed(() => this.session() !== null);

  /**
   * Tells other open tabs of this site that the email was just verified (the link usually
   * opens in a new tab), so a waiting booking page updates itself. Carries no data.
   */
  private readonly tabs =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('mandapambook-auth');

  constructor() {
    this.tabs?.addEventListener('message', (e: MessageEvent) => {
      if (e.data === 'email-verified' && this.user()?.emailVerified === false) void this.refresh();
    });
  }

  /** Called by the verify-email page after a successful verification. */
  announceEmailVerified(): void {
    this.tabs?.postMessage('email-verified');
  }

  get accessToken(): string | null {
    return this.session()?.accessToken ?? null;
  }

  hasPermission(permission: Permission): boolean {
    return this.user()?.permissions.includes(permission) ?? false;
  }

  async login(email: string, password: string, rememberMe: boolean): Promise<void> {
    const session = await firstValueFrom(
      this.http.post<AuthSession>(`${API}/auth/login`, { email, password, rememberMe }),
    );
    this.setSession(session);
  }

  async register(input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    accountType: 'CUSTOMER' | 'OWNER';
  }): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/auth/register`, input));
  }

  /**
   * Exchanges the refresh cookie for a new access token. Concurrent callers share one
   * request: firing two refreshes at once would look like token reuse and end the session.
   */
  refresh(): Promise<boolean> {
    this.refreshInFlight ??= this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const headers = { 'X-CSRF-Token': await this.csrf() };
      const session = await firstValueFrom(
        this.http.post<AuthSession>(`${API}/auth/refresh`, null, { headers }),
      );
      this.setSession(session);
      return true;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 403) this.csrfToken = null;
      this.setSession(null);
      return false;
    }
  }

  private restored: Promise<boolean> | null = null;

  /**
   * Called at startup: restores the session if a valid refresh cookie exists. A visitor
   * who was signed out last time is not checked at all (no wasted round trips, no 401).
   */
  restore(): Promise<boolean> {
    this.restored ??= readSignedInHint() === 'no' ? Promise.resolve(false) : this.refresh();
    return this.restored;
  }

  /** Signed in on this browser last time, so the startup check is worth waiting for. */
  get likelySignedIn(): boolean {
    return readSignedInHint() === 'yes';
  }

  private setSession(session: AuthSession | null): void {
    this.session.set(session);
    writeSignedInHint(session ? 'yes' : 'no');
  }

  /**
   * Resolves once the startup session check has finished. Route guards wait on it, so a
   * signed-in customer is not sent to the sign-in page just because the API was asleep.
   */
  whenRestored(): Promise<boolean> {
    return this.restored ?? Promise.resolve(this.isSignedIn());
  }

  async logout(): Promise<void> {
    try {
      const headers = { 'X-CSRF-Token': await this.csrf() };
      await firstValueFrom(this.http.post(`${API}/auth/logout`, null, { headers }));
    } finally {
      this.setSession(null);
      await this.router.navigateByUrl('/');
    }
  }

  async logoutAll(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${API}/auth/logout-all`, null));
    } finally {
      this.setSession(null);
      await this.router.navigateByUrl('/login');
    }
  }

  sessions(): Promise<{ sessions: SessionInfo[] }> {
    return firstValueFrom(this.http.get<{ sessions: SessionInfo[] }>(`${API}/auth/sessions`));
  }

  async revokeSession(familyId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${API}/auth/sessions/${encodeURIComponent(familyId)}`));
  }

  /** Texts a 6-digit code to the number; verifying it saves the number on the account. */
  async sendPhoneCode(phone: string): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/auth/otp/send`, { phone }));
  }

  async verifyPhoneCode(phone: string, code: string): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/auth/otp/verify`, { phone, code }));
    await this.refresh(); // so the signed-in user shows the verified number
  }

  async verifyEmail(token: string): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/auth/verify-email`, { token }));
  }

  /** Emails a fresh verification link to the signed-in user; earlier links stop working. */
  async resendVerificationEmail(returnTo?: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${API}/auth/verify-email/resend`, returnTo ? { returnTo } : {}),
    );
  }

  async forgotPassword(email: string): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/auth/password/forgot`, { email }));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/auth/password/reset`, { token, password }));
  }

  /** Clears local state when the server reports the session is gone. */
  clear(): void {
    this.setSession(null);
  }

  private async csrf(): Promise<string> {
    this.csrfToken ??= (
      await firstValueFrom(this.http.get<CsrfResponse>(`${API}/auth/csrf`))
    ).csrfToken;
    return this.csrfToken;
  }
}

/** Turns an API error into a message suitable for showing next to a form. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as {
      error?: { code?: string; message?: string; details?: { message: string }[] };
    } | null;
    const detail = Array.isArray(body?.error?.details) ? body.error.details[0]?.message : undefined;
    if (err.status === 0) return 'You appear to be offline. Check your connection and try again.';
    if (err.status === 429) return tooManyAttempts(Number(err.headers.get('Retry-After')));
    if (body?.error?.code === 'MAINTENANCE')
      return 'MandapamBook is down for planned maintenance. Please check back soon.';
    if (body?.error?.code === 'BOOKINGS_PAUSED')
      return body.error.message || 'New bookings are paused for a short while.';
    if (err.status === 502 || err.status === 503 || err.status === 504)
      return 'Our server is starting up. Please try again in a minute.';
    return detail ?? body?.error?.message ?? fallback;
  }
  return fallback;
}

/** "Too many attempts" with how long to wait, from the API's Retry-After (seconds). */
export function tooManyAttempts(retryAfterSeconds: number): string {
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0)
    return 'Too many attempts. Please wait a few minutes and try again.';
  if (retryAfterSeconds < 60) {
    const s = Math.ceil(retryAfterSeconds);
    return `Too many attempts. Please wait ${s} second${s === 1 ? '' : 's'} and try again.`;
  }
  const m = Math.ceil(retryAfterSeconds / 60);
  return `Too many attempts. Please wait ${m} minute${m === 1 ? '' : 's'} and try again.`;
}

/**
 * Whether this browser was signed in last time. Only a hint for how to start up quickly:
 * the session itself lives in an httpOnly cookie and is always checked by the server.
 */
const SIGNED_IN_HINT = 'mb:signed-in';

function readSignedInHint(): 'yes' | 'no' | null {
  try {
    const v = localStorage.getItem(SIGNED_IN_HINT);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
}

function writeSignedInHint(value: 'yes' | 'no'): void {
  try {
    localStorage.setItem(SIGNED_IN_HINT, value);
  } catch {
    // Private mode or blocked storage: startup simply checks the session every time.
  }
}
