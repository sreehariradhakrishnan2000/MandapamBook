import { TestBed } from '@angular/core/testing';
import type { ErrorEvent } from '@sentry/browser';
import { ErrorTracking } from './error-tracking';

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/browser', () => sentry);

describe('browser error tracking', () => {
  beforeEach(() => {
    sentry.init.mockReset();
    sentry.captureException.mockReset();
    TestBed.configureTestingModule({});
  });

  it('stays off, loading nothing, until a DSN is configured', async () => {
    const tracking = TestBed.inject(ErrorTracking);
    tracking.configure(null, 'staging');
    tracking.capture(new Error('boom'));
    await Promise.resolve();
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports errors without the user, cookies or the query string', async () => {
    const tracking = TestBed.inject(ErrorTracking);
    tracking.configure('https://key@o1.ingest.sentry.io/1', 'staging');
    const error = new Error('boom');
    tracking.capture(error);
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalledWith(error));

    const options = sentry.init.mock.calls[0]![0] as {
      environment: string;
      sendDefaultPii: boolean;
      beforeSend: (e: ErrorEvent) => ErrorEvent;
    };
    expect(options).toMatchObject({ environment: 'staging', sendDefaultPii: false });
    const cleaned = options.beforeSend({
      type: undefined,
      user: { email: 'a@b.test' },
      request: {
        url: 'https://site/verify-email?token=secret',
        cookies: { a: 'b' },
        headers: { x: 'y' },
        query_string: 'token=secret',
      },
    } as ErrorEvent);
    expect(cleaned.user).toBeUndefined();
    expect(cleaned.request).toEqual({ url: 'https://site/verify-email' });

    // Configuring twice does not start a second SDK.
    tracking.configure('https://key@o1.ingest.sentry.io/1', 'staging');
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });
});
