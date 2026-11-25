import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AppErrorHandler } from './app-error-handler';
import { tooManyAttempts } from './auth/auth.service';
import { Connectivity, isChunkLoadError } from './connectivity';
import { serverWakeInterceptor } from './server-status';

describe('connectivity', () => {
  let net: Connectivity;
  let script: HTMLScriptElement;

  beforeEach(() => {
    // The page as Angular builds it: a hashed main script.
    script = document.createElement('script');
    script.src = '/main-OLD1234.js';
    document.body.append(script);
    TestBed.configureTestingModule({});
    net = TestBed.inject(Connectivity);
  });
  afterEach(() => {
    script.remove();
    vi.unstubAllGlobals();
  });

  const servedIndex = (main: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><script src="${main}" type="module"></script></html>`,
      }),
    );

  it('spots a new release by the main script the live site now serves', async () => {
    servedIndex('/main-OLD1234.js');
    expect(await net.checkForUpdate()).toBe(false);
    servedIndex('/main-NEW5678.js');
    expect(await net.checkForUpdate()).toBe(true);
    expect(net.updateAvailable()).toBe(true);
  });

  it('follows the browser going offline and back online', async () => {
    window.dispatchEvent(new Event('offline'));
    expect(net.online()).toBe(false);
    const back = net.whenOnline(5_000);
    window.dispatchEvent(new Event('online'));
    await expect(back).resolves.toBe(true);
    expect(net.online()).toBe(true);
  });

  it('turns a missing page chunk into the new-version prompt, other errors into the error card', () => {
    const handler = TestBed.runInInjectionContext(() => new AppErrorHandler());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handler.handleError(new TypeError('Failed to fetch dynamically imported module: /chunk-X.js'));
    expect(net.updateAvailable()).toBe(true);
    expect(net.pageError()).toBe(false);

    // Problems with their own banners (offline, waking, maintenance, signed out) stay quiet.
    for (const status of [0, 401, 502, 503, 504])
      handler.handleError(new HttpErrorResponse({ status }));
    expect(net.pageError()).toBe(false);

    handler.handleError(new Error('Script error.'));
    handler.handleError(new Error('ResizeObserver loop completed with undelivered notifications.'));
    expect(net.pageError()).toBe(false);

    handler.handleError(new Error('Cannot read properties of undefined'));
    expect(net.pageError()).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 7 failed'))).toBe(true);
  });
});

describe('too many attempts', () => {
  it.each([
    [NaN, 'Please wait a few minutes'],
    [1, 'Please wait 1 second and'],
    [30, 'Please wait 30 seconds'],
    [60, 'Please wait 1 minute and'],
    [601, 'Please wait 11 minutes'],
  ])('Retry-After %s → %s', (seconds, expected) => {
    expect(tooManyAttempts(seconds)).toContain(expected);
  });
});

describe('when the connection drops', () => {
  it('waits for it to come back, then loads the page data', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([serverWakeInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const net = TestBed.inject(Connectivity);
    const result = firstValueFrom(TestBed.inject(HttpClient).get('/api/v1/cities'));
    window.dispatchEvent(new Event('offline'));
    http.expectOne('/api/v1/cities').error(new ProgressEvent('error'), { status: 0 });
    await Promise.resolve();
    http.expectNone('/api/v1/cities');
    expect(net.online()).toBe(false);

    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => http.expectOne('/api/v1/cities').flush({ items: ['Kollam'] }));
    await expect(result).resolves.toEqual({ items: ['Kollam'] });
    http.verify();
  });
});
