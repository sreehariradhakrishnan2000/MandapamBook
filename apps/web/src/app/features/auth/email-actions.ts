import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { BUTTON_CLASS, FormField, INPUT_CLASS } from '../../shared/form-field';

@Component({
  selector: 'app-verify-email',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-sm py-8" aria-live="polite">
      @switch (state()) {
        @case ('working') {
          <p>Verifying your email…</p>
        }
        @case ('done') {
          <h1 class="font-display text-2xl font-bold">Email verified</h1>
          <a routerLink="/login" class="mt-4 inline-block font-semibold text-brand-700 underline"
            >Sign in</a
          >
        }
        @default {
          <h1 class="font-display text-2xl font-bold">Link not valid</h1>
          <p class="mt-2 text-slate-600">{{ error() }}</p>
        }
      }
    </section>
  `,
})
export class VerifyEmail implements OnInit {
  private readonly auth = inject(AuthService);
  readonly token = input<string>();
  protected readonly state = signal<'working' | 'done' | 'failed'>('working');
  protected readonly error = signal('This link is invalid or has expired.');

  async ngOnInit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.state.set('failed');
      return;
    }
    try {
      await this.auth.verifyEmail(token);
      this.state.set('done');
    } catch (err) {
      this.error.set(errorMessage(err, this.error()));
      this.state.set('failed');
    }
  }
}

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink, FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-sm py-8">
      <h1 class="font-display text-2xl font-bold">Reset your password</h1>
      @if (sent()) {
        <p class="mt-2 text-slate-600" role="status">
          If an account exists for that email, we have sent a reset link. It expires in 30 minutes.
        </p>
        <a routerLink="/login" class="mt-4 inline-block font-semibold text-brand-700 underline"
          >Back to sign in</a
        >
      } @else {
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
            />
          </app-form-field>
          <button type="submit" [class]="buttonClass" [disabled]="busy()">Send reset link</button>
        </form>
      }
    </section>
  `,
})
export class ForgotPassword {
  private readonly auth = inject(AuthService);
  protected readonly inputClass = INPUT_CLASS;
  protected readonly buttonClass = BUTTON_CLASS;
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.error.set('Enter a valid email address.');
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.forgotPassword(this.form.getRawValue().email);
      this.sent.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink, FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-sm py-8">
      <h1 class="font-display text-2xl font-bold">Choose a new password</h1>
      @if (done()) {
        <p class="mt-2 text-slate-600" role="status">
          Your password is changed and other devices are signed out.
        </p>
        <a routerLink="/login" class="mt-4 inline-block font-semibold text-brand-700 underline"
          >Sign in</a
        >
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
          @if (error()) {
            <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {{ error() }}
            </p>
          }
          <app-form-field for="password" label="New password" hint="At least 10 characters.">
            <input
              id="password"
              type="password"
              formControlName="password"
              autocomplete="new-password"
              [class]="inputClass"
            />
          </app-form-field>
          <button type="submit" [class]="buttonClass" [disabled]="busy()">Change password</button>
        </form>
      }
    </section>
  `,
})
export class ResetPassword {
  private readonly auth = inject(AuthService);
  readonly token = input<string>();
  protected readonly inputClass = INPUT_CLASS;
  protected readonly buttonClass = BUTTON_CLASS;
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
  });

  protected async submit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.error.set('This reset link is incomplete. Request a new one.');
      return;
    }
    if (this.form.invalid) {
      this.error.set('Use 10 to 128 characters.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.resetPassword(token, this.form.getRawValue().password);
      this.done.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
