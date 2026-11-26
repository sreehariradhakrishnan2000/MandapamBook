import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandler, Injectable, inject } from '@angular/core';
import { Connectivity, isChunkLoadError } from './connectivity';
import { ErrorTracking } from './error-tracking';

const QUIET_STATUSES = new Set([0, 401, 502, 503, 504]);

/**
 * Catches errors nothing else handled. A missing page chunk (after a new release) becomes
 * the "new version" prompt; anything else shows the "something went wrong" card instead of
 * leaving a half-broken or blank page. Errors are still logged for debugging.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly connectivity = inject(Connectivity);
  private readonly tracking = inject(ErrorTracking);

  handleError(error: unknown): void {
    console.error(error);
    // Offline, a waking server, maintenance and expired sessions have their own banners.
    if (error instanceof HttpErrorResponse && QUIET_STATUSES.has(error.status)) return;
    // Errors from other sites' scripts (e.g. Razorpay checkout) and a harmless browser
    // layout warning are not our page breaking.
    if (/^Script error\.?$|ResizeObserver loop/.test(messageOf(error))) return;
    if (isChunkLoadError(error)) {
      this.connectivity.updateAvailable.set(true);
      return;
    }
    this.tracking.capture(error);
    this.connectivity.pageError.set(true);
  }
}

function messageOf(error: unknown): string {
  return String((error as { message?: unknown } | null)?.message ?? error ?? '');
}
