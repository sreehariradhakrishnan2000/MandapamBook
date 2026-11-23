import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { BUTTON_CLASS, FormField, INPUT_CLASS } from '../../shared/form-field';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="auth-card">
      <h1 class="font-display text-2xl font-bold">Sign in</h1>
      <p class="mt-1 text-slate-600">Manage your bookings and venues.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
        @if (error()) {
          <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {{ error() }}
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
          <input
            id="password"
            type="password"
            formControlName="password"
            autocomplete="current-password"
            [class]="inputClass"
            [attr.aria-invalid]="invalid('password')"
          />
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
        <a routerLink="/forgot-password" class="text-brand-700 underline">Forgot password?</a>
        <a routerLink="/register" class="text-brand-700 underline">Create an account</a>
      </div>
    </section>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly returnUrl = input<string>();

  protected readonly inputClass = INPUT_CLASS;
  protected readonly buttonClass = BUTTON_CLASS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

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
      this.error.set('Enter your email and password.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const { email, password, rememberMe } = this.form.getRawValue();
      await this.auth.login(email, password, rememberMe);
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      this.error.set(errorMessage(err, 'Sign-in failed. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Only same-app paths are allowed, so a crafted link cannot redirect off-site. */
export function safeReturnUrl(url: string | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') ? url : '/';
}
