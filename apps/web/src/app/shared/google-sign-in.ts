import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Which sign-in options the server offers, asked once per page load. */
@Injectable({ providedIn: 'root' })
export class SignInOptions {
  private readonly http = inject(HttpClient);
  readonly google = signal(false);
  private loaded: Promise<void> | undefined;

  load(): Promise<void> {
    this.loaded ??= firstValueFrom(
      this.http.get<{ google: boolean }>('/api/v1/auth/providers'),
    ).then(
      (p) => this.google.set(p.google),
      () => this.google.set(false), // no button rather than a broken one
    );
    return this.loaded;
  }
}

/** Messages for the ?error= codes the Google callback sends back to the sign-in page. */
export const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_expired: 'That Google sign-in took too long or was started in another tab. Try again.',
  google_failed: "Google sign-in didn't work. Try again.",
  google_email_unverified:
    "Your Google account's email address isn't verified by Google, so it can't be used here.",
  google_other_google_account:
    'This email is already linked to a different Google account. Use that one, or your password.',
  google_suspended: 'This account is suspended. Contact support.',
  google_unavailable: "Google sign-in isn't available right now. Use your email and password.",
};

/**
 * "Continue with Google": a plain link to the API, which runs the OAuth redirect and
 * brings the person back signed in. No Google script runs on our pages.
 */
@Component({
  selector: 'app-google-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options.google()) {
      <a
        [href]="href()"
        class="inline-flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-5 py-3 font-semibold text-ink transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <svg aria-hidden="true" viewBox="0 0 48 48" class="size-5">
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
          />
          <path
            fill="#FF3D00"
            d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
          />
        </svg>
        Continue with Google
      </a>
      <div class="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
        <span class="h-px flex-1 bg-slate-200"></span>or<span
          class="h-px flex-1 bg-slate-200"
        ></span>
      </div>
    }
  `,
  host: { class: 'contents' },
})
export class GoogleSignIn {
  protected readonly options = inject(SignInOptions);
  /** Owners get an owner account if this is their first sign-in. */
  readonly intent = input<'customer' | 'owner'>('customer');
  readonly returnUrl = input<string>('/');

  protected readonly href = computed(() => {
    const q = new URLSearchParams({ returnUrl: this.returnUrl() || '/' });
    if (this.intent() === 'owner') q.set('intent', 'owner');
    return `/api/v1/auth/google/start?${q.toString()}`;
  });

  constructor() {
    void this.options.load();
  }
}
