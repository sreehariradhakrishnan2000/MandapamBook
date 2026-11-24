import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  type AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { BUTTON_CLASS, FormField, INPUT_CLASS } from '../../shared/form-field';
import { GoogleSignIn } from '../../shared/google-sign-in';
import { PasswordToggle } from '../../shared/password-toggle';

/** Indian mobile: 10 digits starting 6–9, optional +91/0 prefix, spaces or dashes allowed. */
export function indianMobile(control: AbstractControl<string>): ValidationErrors | null {
  const v = (control.value ?? '').replace(/[\s\-()]/g, '');
  if (!v) return null;
  return /^(?:\+91|91|0)?[6-9]\d{9}$/.test(v) ? null : { indianMobile: true };
}

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, FormField, PasswordToggle, GoogleSignIn],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="auth-card">
      @if (done()) {
        <h1 class="font-display text-3xl font-medium">Check your email</h1>
        <p class="mt-2 text-slate-600">
          We sent a verification link to <strong>{{ form.controls.email.value }}</strong>. Open it
          within 24 hours, then sign in.
        </p>
        <a routerLink="/login" class="mt-6 inline-block font-semibold text-brand-700 underline"
          >Go to sign in</a
        >
      } @else {
        <h1 class="font-display text-3xl font-medium">Create your account</h1>
        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
          @if (error()) {
            <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {{ error() }}
            </p>
          }
          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium text-slate-800">I want to</legend>
            <label class="flex items-center gap-2"
              ><input type="radio" value="CUSTOMER" formControlName="accountType" /> Book a
              hall</label
            >
            <label class="flex items-center gap-2"
              ><input type="radio" value="OWNER" formControlName="accountType" /> List my
              venue</label
            >
          </fieldset>
          <app-google-sign-in
            [intent]="form.controls.accountType.value === 'OWNER' ? 'owner' : 'customer'"
            [returnUrl]="form.controls.accountType.value === 'OWNER' ? '/owner' : '/'"
          />
          <app-form-field
            for="fullName"
            label="Full name"
            [error]="show('fullName') ? 'Enter your name' : null"
          >
            <input
              id="fullName"
              formControlName="fullName"
              autocomplete="name"
              [class]="inputClass"
              [attr.aria-invalid]="show('fullName')"
            />
          </app-form-field>
          <app-form-field
            for="email"
            label="Email"
            [error]="show('email') ? 'Enter a valid email address' : null"
          >
            <input
              id="email"
              type="email"
              formControlName="email"
              autocomplete="email"
              [class]="inputClass"
              [attr.aria-invalid]="show('email')"
            />
          </app-form-field>
          <app-form-field
            for="phone"
            label="Mobile number (optional)"
            hint="10-digit Indian mobile, e.g. 98765 43210"
            [error]="show('phone') ? 'Enter a valid 10-digit Indian mobile number' : null"
          >
            <input
              id="phone"
              type="tel"
              inputmode="tel"
              formControlName="phone"
              autocomplete="tel-national"
              [class]="inputClass"
              [attr.aria-invalid]="show('phone')"
            />
          </app-form-field>
          <app-form-field
            for="password"
            label="Password"
            hint="At least 10 characters. A short phrase works well."
            [error]="show('password') ? 'Use 10 to 128 characters' : null"
          >
            <div class="relative">
              <input
                #pw
                id="password"
                type="password"
                formControlName="password"
                autocomplete="new-password"
                [class]="inputClass + ' pr-12'"
                [attr.aria-invalid]="show('password')"
              />
              <app-password-toggle [input]="pw" />
            </div>
          </app-form-field>
          <button type="submit" [class]="buttonClass" [disabled]="busy()">
            {{ busy() ? 'Creating account…' : 'Create account' }}
          </button>
        </form>
        <p class="mt-6 text-sm">
          Already registered? <a routerLink="/login" class="text-brand-700 underline">Sign in</a>
        </p>
      }
    </section>
  `,
})
export class Register {
  private readonly auth = inject(AuthService);
  protected readonly inputClass = INPUT_CLASS;
  protected readonly buttonClass = BUTTON_CLASS;
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    accountType: ['CUSTOMER' as 'CUSTOMER' | 'OWNER'],
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', indianMobile],
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
  });

  protected show(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { phone, ...rest } = this.form.getRawValue();
      await this.auth.register(phone ? { ...rest, phone } : rest);
      this.done.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
