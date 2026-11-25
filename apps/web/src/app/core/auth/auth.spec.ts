import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { AuthSession } from '@mandapambook/shared';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { signedIn, withPermission } from './guards';

const session = (token = 'access-1'): AuthSession => ({
  accessToken: token,
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'priya@example.test',
    fullName: 'Priya Nair',
    phone: null,
    role: 'CUSTOMER',
    emailVerified: true,
    phoneVerified: false,
    permissions: ['booking:create'],
  },
});

describe('AuthService and interceptor', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let client: HttpClient;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    client = TestBed.inject(HttpClient);
  });

  afterEach(() => http.verify());

  /** Waits until a request to url is pending (async hops vary), then returns it. */
  const pending = (url: string) => vi.waitFor(() => http.expectOne(url));

  async function flushRefresh(token: string, status = 200): Promise<void> {
    (await pending('/api/v1/auth/csrf')).flush({ csrfToken: 'csrf-1' });
    const req = await pending('/api/v1/auth/refresh');
    expect(req.request.headers.get('X-CSRF-Token')).toBe('csrf-1');
    if (status === 200) req.flush(session(token));
    else req.flush({ error: { code: 'UNAUTHENTICATED' } }, { status, statusText: 'err' });
  }

  it('keeps the access token in memory and exposes the user', async () => {
    const done = auth.login('priya@example.test', 'pw', false);
    http.expectOne('/api/v1/auth/login').flush(session());
    await done;
    expect(auth.accessToken).toBe('access-1');
    expect(auth.user()?.fullName).toBe('Priya Nair');
    expect(auth.hasPermission('booking:create')).toBe(true);
    expect(auth.hasPermission('audit:view')).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('shares one refresh request between concurrent callers', async () => {
    const a = auth.refresh();
    const b = auth.refresh();
    await flushRefresh('access-2');
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(auth.accessToken).toBe('access-2');
  });

  it('attaches the bearer token to API calls only', async () => {
    const done = auth.login('priya@example.test', 'pw', false);
    http.expectOne('/api/v1/auth/login').flush(session());
    await done;

    void firstValueFrom(client.get('/api/v1/auth/me'));
    expect(http.expectOne('/api/v1/auth/me').request.headers.get('Authorization')).toBe(
      'Bearer access-1',
    );

    void firstValueFrom(client.get('https://tiles.example.org/1/2/3.png'));
    expect(
      http.expectOne('https://tiles.example.org/1/2/3.png').request.headers.has('Authorization'),
    ).toBe(false);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const done = auth.login('priya@example.test', 'pw', false);
    http.expectOne('/api/v1/auth/login').flush(session('old'));
    await done;

    const result = firstValueFrom(client.get<{ ok: boolean }>('/api/v1/auth/me'));
    http.expectOne('/api/v1/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await flushRefresh('new');
    const retry = await pending('/api/v1/auth/me');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new');
    retry.flush({ ok: true });
    expect(await result).toEqual({ ok: true });
  });

  it('signs out and goes to login when the refresh also fails', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const result = firstValueFrom(client.get('/api/v1/auth/me'));
    http.expectOne('/api/v1/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await flushRefresh('', 401);
    await expect(result).rejects.toBeTruthy();
    expect(auth.isSignedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], expect.anything());
  });

  it('never retries the login request itself', async () => {
    const done = auth.login('x@example.test', 'bad', false);
    http.expectOne('/api/v1/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(done).rejects.toBeTruthy();
    http.expectNone('/api/v1/auth/refresh');
  });

  it('guards redirect signed-out users to login with a return URL', async () => {
    const tree = await TestBed.runInInjectionContext(() =>
      signedIn({}, [{ path: 'account' } as never], {} as never),
    );
    expect(String(tree)).toBe('/login?returnUrl=%2Faccount');
  });

  it('permission guard sends users without the permission home', async () => {
    const done = auth.login('priya@example.test', 'pw', false);
    http.expectOne('/api/v1/auth/login').flush(session());
    await done;
    const tree = await TestBed.runInInjectionContext(() =>
      withPermission('audit:view')({}, [{ path: 'admin' } as never], {} as never),
    );
    expect(String(tree)).toBe('/');
  });
});
