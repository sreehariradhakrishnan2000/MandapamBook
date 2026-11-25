import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { type Observable, catchError, defer, tap, throwError, timer, switchMap } from 'rxjs';
import { API } from './auth/auth.service';

/**
 * The hosting plan puts the API to sleep after a quiet spell, and waking it takes up to a
 * minute. Meanwhile the proxy answers 502/503/504. This service tracks that state so the
 * app can say "starting up" instead of looking broken.
 */
@Injectable({ providedIn: 'root' })
export class ServerStatus {
  /** True while the API is not answering yet; drives the banner in the app shell. */
  readonly waking = signal(false);
  /**
   * Set while planned maintenance is on (the API answered 503 MAINTENANCE, or /status says
   * so). Customers then see the maintenance page; admins see a reminder bar.
   */
  readonly maintenance = signal<MaintenanceInfo | null>(null);
  private probing = false;

  /** Asks the API whether maintenance is on. Never throws: unknown means "not on". */
  async checkMaintenance(): Promise<boolean> {
    if (typeof fetch === 'undefined') return false;
    try {
      const res = await fetch(`${API}/status`, { cache: 'no-store' });
      if (!res.ok) return this.maintenance() !== null;
      const body = (await res.json()) as {
        maintenance?: { enabled: boolean; message: string; until: string | null };
      };
      const m = body.maintenance;
      this.maintenance.set(m?.enabled ? { message: m.message, until: m.until } : null);
      return Boolean(m?.enabled);
    } catch {
      return this.maintenance() !== null;
    }
  }

  markWaking(): void {
    this.waking.set(true);
    void this.probe();
  }

  markUp(): void {
    this.waking.set(false);
  }

  /**
   * After a request we may not retry (e.g. "Hold this date") hit a sleeping server, polls
   * a cheap public endpoint so the banner clears once the API is up.
   */
  private async probe(): Promise<void> {
    if (this.probing || typeof fetch === 'undefined') return;
    this.probing = true;
    try {
      const until = Date.now() + WAKE_WINDOW_MS;
      while (this.waking() && Date.now() < until) {
        await sleep(3_000);
        try {
          const res = await fetch(`${API}/payments/config`, { cache: 'no-store' });
          if (res.ok) this.markUp();
        } catch {
          // still waking
        }
      }
    } finally {
      this.probing = false;
    }
  }
}

/** How long we keep waiting for the API to wake before giving up. */
export const WAKE_WINDOW_MS = 90_000;
const WAKING_STATUSES = new Set([502, 503, 504]);
/** Delays between retries: quick at first, then every 5 seconds. */
const RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000];

export interface MaintenanceInfo {
  message: string;
  until: string | null;
}

/** The API's planned-maintenance answer (503 with code MAINTENANCE). */
export function maintenanceFrom(err: unknown): MaintenanceInfo | null {
  if (!(err instanceof HttpErrorResponse) || err.status !== 503) return null;
  const body = err.error as {
    error?: { code?: string; message?: string; details?: { until?: string | null } };
  } | null;
  if (body?.error?.code !== 'MAINTENANCE') return null;
  return { message: body.error.message ?? '', until: body.error.details?.until ?? null };
}

export function isWakingError(err: unknown): err is HttpErrorResponse {
  return (
    err instanceof HttpErrorResponse && WAKING_STATUSES.has(err.status) && !maintenanceFrom(err)
  );
}

/**
 * Requests that are safe to send again while the API wakes: reads, the CSRF token, and
 * the session refresh when the proxy says the API was not reached (502/503), so a sleeping
 * server does not sign anyone out. Bookings and payments are never retried automatically.
 */
function retryable(req: HttpRequest<unknown>, err: HttpErrorResponse): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return req.url.endsWith('/auth/refresh') && (err.status === 502 || err.status === 503);
}

export const serverWakeInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API)) return next(req);
  const status = inject(ServerStatus);
  const started = Date.now();

  const attempt = (n: number): Observable<HttpEvent<unknown>> =>
    defer(() => next(req)).pipe(
      tap(() => {
        if (status.waking()) status.markUp();
      }),
      catchError((err: unknown) => {
        const planned = maintenanceFrom(err);
        if (planned) {
          // Planned maintenance: no retrying; the app shows the maintenance page.
          status.markUp();
          status.maintenance.set(planned);
          return throwError(() => err);
        }
        if (!isWakingError(err)) return throwError(() => err);
        if (!retryable(req, err)) {
          status.markWaking();
          return throwError(() => err);
        }
        const delay = RETRY_DELAYS_MS[Math.min(n, RETRY_DELAYS_MS.length - 1)] ?? 5_000;
        if (Date.now() - started + delay > WAKE_WINDOW_MS) return throwError(() => err);
        status.waking.set(true);
        return timer(delay).pipe(switchMap(() => attempt(n + 1)));
      }),
    );
  return attempt(0);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
