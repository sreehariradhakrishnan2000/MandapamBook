import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { FormControl } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { VerifyEmail } from './email-actions';
import { Login, safeReturnUrl } from './login';
import { Register, indianMobile } from './register';

describe('safeReturnUrl', () => {
  it.each([
    ['/account', '/account'],
    ['/owner/venues?x=1', '/owner/venues?x=1'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    [undefined, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnUrl(input)).toBe(expected);
  });
});

describe('indianMobile validator', () => {
  it.each(['9876543210', '+91 98765 43210', '098765-43210', ''])('accepts %s', (v) => {
    expect(indianMobile(new FormControl(v, { nonNullable: true }))).toBeNull();
  });
  it.each(['5876543210', '98765', '+1 2025550123'])('rejects %s', (v) => {
    expect(indianMobile(new FormControl(v, { nonNullable: true }))).toEqual({ indianMobile: true });
  });
});

describe('auth forms', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it.each<[string, Type<unknown>]>([
    ['login', Login],
    ['register', Register],
  ])('%s can show and hide the password, keeping what was typed', async (_, component) => {
    const fixture = TestBed.createComponent(component);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const field = el.querySelector<HTMLInputElement>('#password')!;
    const toggle = el.querySelector<HTMLButtonElement>('button[aria-controls=password]')!;
    field.value = 'mandapam-2026';
    field.dispatchEvent(new Event('input'));
    expect(toggle.textContent?.trim()).toBe('Show password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.type).toBe('button'); // never submits the form

    toggle.click();
    fixture.detectChanges();
    expect(field.type).toBe('text');
    expect(field.value).toBe('mandapam-2026');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.title).toBe('Hide password');

    toggle.click();
    fixture.detectChanges();
    expect(field.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    const http = TestBed.inject(HttpTestingController);
    http.match('/api/v1/auth/providers').forEach((r) => r.flush({ google: false }));
    http.verify(); // nothing else was sent
  });

  it('login shows a message and sends nothing when fields are empty', async () => {
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'Enter your email and password',
    );
    TestBed.inject(HttpTestingController).expectNone('/api/v1/auth/login');
  });

  it('login shows the server error message', async () => {
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const set = (id: string, v: string) => {
      const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    set('email', 'priya@example.test');
    set('password', 'wrong password');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/auth/login')
      .flush(
        { error: { code: 'INVALID_CREDENTIALS', message: 'The email or password is incorrect' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'The email or password is incorrect',
    );
  });

  it('register labels every field and flags an invalid phone', async () => {
    const fixture = TestBed.createComponent(Register);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    for (const id of ['fullName', 'email', 'phone', 'password']) {
      expect(el.querySelector(`label[for=${id}]`)).not.toBeNull();
    }
    const phone = el.querySelector<HTMLInputElement>('#phone')!;
    phone.value = '12345';
    phone.dispatchEvent(new Event('input'));
    phone.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(el.textContent).toContain('valid 10-digit Indian mobile');
  });
});

describe('Continue with Google', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function render<T>(
    component: Type<T>,
    google: boolean,
    inputs: Record<string, string> = {},
  ) {
    const fixture = TestBed.createComponent(component);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/v1/auth/providers').flush({ google });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const googleLink = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLAnchorElement>('a')].find((a) =>
      a.textContent?.includes('Continue with Google'),
    );

  it('is hidden when the server has not set up Google sign-in', async () => {
    expect(googleLink(await render(Login, false))).toBeUndefined();
  });

  it('links to the API with a safe return path', async () => {
    const el = await render(Login, true, { returnUrl: '/venues/x?date=2027-01-21' });
    const href = new URL(googleLink(el)!.getAttribute('href')!, 'http://app.test');
    expect(href.pathname).toBe('/api/v1/auth/google/start');
    expect(href.searchParams.get('returnUrl')).toBe('/venues/x?date=2027-01-21');
    expect(href.searchParams.has('intent')).toBe(false);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const evil = await render(Login, true, { returnUrl: '//evil.example' });
    const evilHref = new URL(googleLink(evil)!.getAttribute('href')!, 'http://app.test');
    expect(evilHref.searchParams.get('returnUrl')).toBe('/');
  });

  it('asks for an owner account when "List my venue" is chosen', async () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/auth/providers')
      .flush({ google: true });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const intent = () =>
      new URL(googleLink(el)!.getAttribute('href')!, 'http://app.test').searchParams.get('intent');
    expect(intent()).toBeNull();

    el.querySelector<HTMLInputElement>('input[value=OWNER]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(intent()).toBe('owner');
    const href = new URL(googleLink(el)!.getAttribute('href')!, 'http://app.test');
    expect(href.searchParams.get('returnUrl')).toBe('/owner');
  });

  it('explains a failed Google sign-in on the sign-in page', async () => {
    const el = await render(Login, true, { error: 'google_other_google_account' });
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'already linked to a different Google account',
    );
  });
});

describe('verify email page', () => {
  let http: HttpTestingController;
  const pending = (url: string) => vi.waitFor(() => http.expectOne((r) => r.url === url));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('sends a signed-in customer straight back to where they left off', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(VerifyEmail);
    fixture.componentRef.setInput('token', 'tok');
    fixture.componentRef.setInput('next', '/book/h1?date=2030-01-09&slot=EVENING');
    fixture.detectChanges();
    (await pending('/api/v1/auth/verify-email')).flush({ message: 'ok' });
    (await pending('/api/v1/auth/csrf')).flush({ csrfToken: 'c' });
    (await pending('/api/v1/auth/refresh')).flush({
      accessToken: 't',
      expiresIn: 900,
      user: { id: 'u1', email: 'u@example.test', emailVerified: true },
    });
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/book/h1?date=2030-01-09&slot=EVENING&verified=1'),
    );
  });

  it('asks to sign in on another device, and never follows an off-site next', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(VerifyEmail);
    fixture.componentRef.setInput('token', 'tok');
    fixture.componentRef.setInput('next', '//evil.example/');
    fixture.detectChanges();
    (await pending('/api/v1/auth/verify-email')).flush({ message: 'ok' });
    (await pending('/api/v1/auth/csrf')).flush({ csrfToken: 'c' });
    (await pending('/api/v1/auth/refresh')).flush(
      { error: { code: 'UNAUTHENTICATED' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(el.textContent).toContain('Sign in to continue'));
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/login?returnUrl=%2Faccount');
  });
});
