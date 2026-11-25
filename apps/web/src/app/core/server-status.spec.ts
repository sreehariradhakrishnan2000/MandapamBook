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

describe('planned maintenance', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let status: ServerStatus;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([serverWakeInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    status = TestBed.inject(ServerStatus);
  });
  afterEach(() => http.verify());

  it('switches to the maintenance page at once, without retrying or a waking banner', async () => {
    const until = '2030-01-09T10:00:00.000Z';
    const result = firstValueFrom(client.get('/api/v1/cities'));
    http
      .expectOne('/api/v1/cities')
      .flush(
        { error: { code: 'MAINTENANCE', message: 'Upgrading payments', details: { until } } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await expect(result).rejects.toMatchObject({ status: 503 });
    http.expectNone('/api/v1/cities');
    expect(status.waking()).toBe(false);
    expect(status.maintenance()).toEqual({ message: 'Upgrading payments', until });
    expect(errorMessage(await result.catch((e: unknown) => e))).toContain('planned maintenance');
  });
});

describe('site switches', () => {
  afterEach(() => vi.unstubAllGlobals());

  const status = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));

  it('reads the bookings pause and an upcoming maintenance window, and drops past ones', async () => {
    TestBed.configureTestingModule({});
    const server = TestBed.inject(ServerStatus);
    const from = new Date(Date.now() + 86_400_000).toISOString();
    const to = new Date(Date.now() + 90_000_000).toISOString();
    status({
      maintenance: {
        enabled: false,
        message: '',
        until: null,
        scheduledFrom: from,
        scheduledTo: to,
      },
      bookings: { paused: true, message: 'Razorpay is down' },
    });
    expect(await server.checkMaintenance()).toBe(false);
    expect(server.scheduled()).toEqual({ from, to });
    expect(server.bookingsPaused()).toEqual({ message: 'Razorpay is down' });

    status({
      maintenance: {
        enabled: false,
        message: '',
        until: null,
        scheduledFrom: '2020-01-01T00:00:00Z',
        scheduledTo: '2020-01-01T01:00:00Z',
      },
      bookings: { paused: false, message: '' },
    });
    await server.checkMaintenance();
    expect(server.scheduled()).toBeNull();
    expect(server.bookingsPaused()).toBeNull();
  });

  it('turns a paused-booking answer into the banner, without retrying', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([serverWakeInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const server = TestBed.inject(ServerStatus);
    const hold = firstValueFrom(TestBed.inject(HttpClient).post('/api/v1/bookings', {}));
    http
      .expectOne('/api/v1/bookings')
      .flush(
        { error: { code: 'BOOKINGS_PAUSED', message: 'Razorpay is down' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    const err = await hold.catch((e: unknown) => e);
    expect(server.bookingsPaused()).toEqual({ message: 'Razorpay is down' });
    expect(server.waking()).toBe(false);
    expect(errorMessage(err)).toBe('Razorpay is down');
    http.verify();
  });
});
