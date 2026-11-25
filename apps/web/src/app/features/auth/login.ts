import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { BUTTON_CLASS, FormField, INPUT_CLASS } from '../../shared/form-field';
import { GOOGLE_ERRORS, GoogleSignIn } from '../../shared/google-sign-in';
import { PasswordToggle } from '../../shared/password-toggle';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, FormField, PasswordToggle, GoogleSignIn],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="auth-card">
      <h1 class="font-display text-3xl font-medium">Sign in</h1>
      <p class="mt-1 text-slate-600">Manage your bookings and venues.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
        @if (googleMessage(); as message) {
          <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {{ message }}
          </p>
        }
        <app-google-sign-in [returnUrl]="safeReturn()" />
        @if (formError()) {
          <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {{ formError() }}
          </p>
        }
        <app-form-field for="email" label="Email">
          <input
            id="email"
            type="email"
            formControlName="email"
            autocomplete="email"
            [class]="inputClass"
            [attr.aria-invalid]="invalid('email')"
          />
        </app-form-field>
        <app-form-field for="password" label="Password">
          <div class="relative">
            <input
              #pw
              id="password"
              type="password"
              formControlName="password"
              autocomplete="current-password"
              [class]="inputClass + ' pr-12'"
              [attr.aria-invalid]="invalid('password')"
            />
            <app-password-toggle [input]="pw" />
          </div>
        </app-form-field>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" formControlName="rememberMe" class="size-4" />
          Keep me signed in for 30 days
        </label>
        <button type="submit" [class]="buttonClass" [disabled]="busy()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <div class="mt-6 flex justify-between text-sm">
        <a routerLink="/forgot-password" class="tap text-brand-700 underline">Forgot password?</a>
        <a routerLink="/register" class="tap text-brand-700 underline">Create an account</a>
      </div>
    </section>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly returnUrl = input<string>();
  /** ?error= from a failed Google sign-in. */
  readonly error = input<string>();

  protected readonly safeReturn = computed(() => safeReturnUrl(this.returnUrl()));
  protected readonly googleMessage = computed(() => {
    const code = this.error();
    return code ? (GOOGLE_ERRORS[code] ?? "Google sign-in didn't work. Try again.") : null;
  });

  protected readonly inputClass = INPUT_CLASS;
  protected readonly buttonClass = BUTTON_CLASS;
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    rememberMe: [false],
  });

  protected invalid(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.formError.set('Enter your email and password.');
      return;
    }
    this.busy.set(true);
    this.formError.set(null);
    try {
      const { email, password, rememberMe } = this.form.getRawValue();
      await this.auth.login(email, password, rememberMe);
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      this.formError.set(errorMessage(err, 'Sign-in failed. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Only same-app paths are allowed, so a crafted link cannot redirect off-site. */
export function safeReturnUrl(url: string | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') ? url : '/';
}
