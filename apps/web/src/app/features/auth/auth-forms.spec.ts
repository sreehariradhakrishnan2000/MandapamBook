import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { FormControl } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
    TestBed.inject(HttpTestingController).verify();
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
