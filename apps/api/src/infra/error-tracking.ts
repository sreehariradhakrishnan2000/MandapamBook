import type { Logger } from 'pino';

import type * as SentrySdk from '@sentry/node';

type Sentry = typeof SentrySdk;
let sentry: Sentry | null = null;

/**
 * Optional error tracking with Sentry. Off unless SENTRY_DSN is set; then the SDK is
 * loaded and unexpected server errors are reported with their correlation id.
 * No personal data: no IP addresses, cookies, headers or request bodies are sent.
 */
export async function initErrorTracking(opts: {
  dsn: string | undefined;
  environment: string;
  release: string;
  logger: Logger;
}): Promise<void> {
  if (!opts.dsn) return;
  try {
    const sdk = await import('@sentry/node');
    sdk.init({
      dsn: opts.dsn,
      environment: opts.environment,
      release: opts.release,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // Belt and braces: strip anything that could identify a person.
      beforeSend(event) {
        if (event.request) {
          delete event.request.cookies;
          delete event.request.headers;
          delete event.request.data;
          delete event.request.query_string;
        }
        delete event.user;
        return event;
      },
    });
    sentry = sdk;
    opts.logger.info({ environment: opts.environment }, 'error tracking on');
  } catch (err) {
    opts.logger.warn({ err }, 'error tracking could not start; continuing without it');
  }
}

/** Reports an unexpected error. A no-op when error tracking is off. */
export function captureError(err: unknown, context: Record<string, string>): void {
  sentry?.captureException(err, { tags: context });
}
