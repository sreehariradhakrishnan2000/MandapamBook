import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from './auth/auth.service';
import { ServerStatus, serverWakeInterceptor } from './server-status';

describe('while the API wakes up', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let status: ServerStatus;
  const asleep = { status: 502, statusText: 'Bad Gateway' };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([serverWakeInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    status = TestBed.inject(ServerStatus);
    // The banner's background check uses fetch; keep it quiet and "still asleep".
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('asleep')));
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries page loads, shows the banner, and clears it once the server answers', async () => {
    const result = firstValueFrom(client.get<{ items: string[] }>('/api/v1/cities'));
    http.expectOne('/api/v1/cities').flush('', asleep);
    expect(status.waking()).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    http.expectOne('/api/v1/cities').flush('', { status: 504, statusText: 'Gateway Timeout' });
    await vi.advanceTimersByTimeAsync(2_000);
    http.expectOne('/api/v1/cities').flush({ items: ['Kochi'] });

    await expect(result).resolves.toEqual({ items: ['Kochi'] });
    expect(status.waking()).toBe(false);
  });

  it('never resends a booking or payment on its own, but still shows the banner', async () => {
    const hold = firstValueFrom(client.post('/api/v1/bookings', { hallId: 'h1' }));
    http.expectOne('/api/v1/bookings').flush('', asleep);
    await expect(hold).rejects.toMatchObject({ status: 502 });
    expect(status.waking()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    http.expectNone('/api/v1/bookings');
    status.markUp();
  });

  it('retries the session refresh so a sleeping server does not sign anyone out', async () => {
    const refresh = firstValueFrom(client.post('/api/v1/auth/refresh', null));
    http.expectOne('/api/v1/auth/refresh').flush('', asleep);
    await vi.advanceTimersByTimeAsync(1_000);
    http.expectOne('/api/v1/auth/refresh').flush({ accessToken: 't' });
    await expect(refresh).resolves.toEqual({ accessToken: 't' });
  });

  it('gives up after about 90 seconds', async () => {
    const result = firstValueFrom(client.get('/api/v1/cities'));
    const failed = expect(result).rejects.toMatchObject({ status: 502 });
    for (let i = 0; i < 30; i++) {
      const pending = http.match('/api/v1/cities');
      if (!pending.length) break;
      pending.forEach((r) => r.flush('', asleep));
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await failed;
    status.markUp();
  });

  it('tells the customer the server is starting, not that something broke', async () => {
    const hold = firstValueFrom(client.post('/api/v1/bookings', {}));
    http.expectOne('/api/v1/bookings').flush('<html>Bad Gateway</html>', asleep);
    const err = await hold.catch((e: unknown) => e);
    expect(errorMessage(err)).toBe('Our server is starting up. Please try again in a minute.');
    status.markUp();
  });
});
