import { Injectable } from '@angular/core';
import type * as SentryBrowser from '@sentry/browser';

type Sentry = typeof SentryBrowser;

/**
 * Optional browser error tracking with Sentry. Off unless the API's /status names a DSN
 * (SENTRY_WEB_DSN); only then is the SDK downloaded. Nothing that identifies a person is
 * sent: no user, IP, cookies, request bodies or query strings.
 */
@Injectable({ providedIn: 'root' })
export class ErrorTracking {
  private sdk: Promise<Sentry | null> | null = null;

  configure(dsn: string | null | undefined, environment: string): void {
    if (!dsn || this.sdk) return;
    this.sdk = import('@sentry/browser').then(
      (sentry) => {
        sentry.init({
          dsn,
          environment,
          sendDefaultPii: false,
          // Only errors, no performance tracing or session replays.
          tracesSampleRate: 0,
          integrations: (defaults) =>
            defaults.filter((i) => i.name !== 'BrowserSession' && i.name !== 'Breadcrumbs'),
          beforeSend(event) {
            delete event.user;
            if (event.request) {
              delete event.request.cookies;
              delete event.request.headers;
              delete event.request.data;
              delete event.request.query_string;
              // Booking links carry tokens and ids in the query; keep only the path.
              if (event.request.url) event.request.url = event.request.url.split('?')[0];
            }
            return event;
          },
        });
        return sentry;
      },
      () => null,
    );
  }

  /** Reports an error. A no-op until configured, and when tracking is off. */
  capture(error: unknown): void {
    void this.sdk?.then((sentry) => sentry?.captureException(error));
  }
}
