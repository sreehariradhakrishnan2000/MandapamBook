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
    this.session.set(session);
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
      this.session.set(session);
      return true;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 403) this.csrfToken = null;
      this.session.set(null);
      return false;
    }
  }

  private restored: Promise<boolean> | null = null;

  /** Called at startup: restores the session if a valid refresh cookie exists. */
  restore(): Promise<boolean> {
    this.restored ??= this.refresh();
    return this.restored;
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
      this.session.set(null);
      await this.router.navigateByUrl('/');
    }
  }

  async logoutAll(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${API}/auth/logout-all`, null));
    } finally {
      this.session.set(null);
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
    this.session.set(null);
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
      error?: { message?: string; details?: { message: string }[] };
    } | null;
    const detail = body?.error?.details?.[0]?.message;
    if (err.status === 0) return 'You appear to be offline. Check your connection and try again.';
    if (err.status === 502 || err.status === 503 || err.status === 504)
      return 'Our server is starting up. Please try again in a minute.';
    return detail ?? body?.error?.message ?? fallback;
  }
  return fallback;
}
