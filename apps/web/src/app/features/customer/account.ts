import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { normalizeIndianMobile } from '@mandapambook/shared';
import { AuthService, type SessionInfo, errorMessage } from '../../core/auth/auth.service';

@Component({
  selector: 'app-account',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-8 py-6">
      <header>
        <h1 class="font-display text-3xl font-medium">Your account</h1>
        @if (auth.user(); as user) {
          <p class="mt-1 text-slate-600">{{ user.fullName }} · {{ user.email }}</p>
          @if (!user.emailVerified) {
            <p class="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700">
              Verify your email to make bookings. Check your inbox for the link.
            </p>
          }
        }
      </header>

      <section aria-labelledby="phone-heading" id="phone" class="flex flex-col gap-3">
        <h2 id="phone-heading" class="font-display text-lg font-medium">Mobile number</h2>
        @if (auth.user(); as user) {
          @if (user.phone) {
            <p class="text-sm">
              {{ user.phone }}
              @if (user.phoneVerified) {
                <span
                  class="ml-1 rounded-full bg-forest-50 px-2 py-0.5 text-xs font-semibold text-forest-800 ring-1 ring-forest-200"
                  >Verified</span
                >
              } @else {
                <span class="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                  >Not verified</span
                >
              }
            </p>
          }
          <p class="text-sm text-slate-600">
            Needed to write reviews. A verified number also shows you bookings a venue made for you
            by phone or in person, so you can review those too.
          </p>
          @if (!user.phone || !user.phoneVerified || changingPhone()) {
            <form
              class="flex flex-wrap items-end gap-2 text-sm"
              (submit)="$event.preventDefault(); codeSent() ? verify() : send()"
            >
              <label class="flex flex-col gap-1"
                >Mobile number
                <input
                  name="phone"
                  inputmode="tel"
                  autocomplete="tel-national"
                  placeholder="98470 12345"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-2"
                  [value]="phone()"
                  (input)="phone.set($any($event.target).value)"
                  [readOnly]="codeSent()"
                />
              </label>
              @if (codeSent()) {
                <label class="flex flex-col gap-1"
                  >6-digit code
                  <input
                    name="code"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="6"
                    class="w-32 rounded-xl border border-slate-300 bg-white px-3 py-2 tracking-widest"
                    [value]="code()"
                    (input)="code.set($any($event.target).value)"
                  />
                </label>
              }
              <button
                type="submit"
                [disabled]="phoneBusy()"
                class="rounded-full bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {{
                  codeSent()
                    ? 'Verify'
                    : user.phone && !changingPhone()
                      ? 'Verify this number'
                      : 'Send code'
                }}
              </button>
              @if (codeSent()) {
                <button
                  type="button"
                  class="pb-2 text-slate-600 underline"
                  (click)="codeSent.set(false)"
                >
                  Change number
                </button>
              }
            </form>
          } @else {
            <button
              type="button"
              class="w-fit text-sm text-brand-700 underline"
              (click)="changingPhone.set(true); phone.set('')"
            >
              Change number
            </button>
          }
          @if (phoneMessage(); as m) {
            <p
              class="text-sm"
              [class.text-red-700]="m.error"
              [class.text-forest-800]="!m.error"
              role="status"
            >
              {{ m.text }}
            </p>
          }
        }
      </section>

      <section aria-labelledby="sessions-heading">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="sessions-heading" class="font-display text-lg font-medium">Signed-in devices</h2>
          <button
            type="button"
            (click)="logoutAll()"
            class="rounded-full border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Sign out of all devices
          </button>
        </div>
        @if (error()) {
          <p class="mt-3 text-sm text-red-700" role="alert">{{ error() }}</p>
        }
        <ul class="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          @for (s of sessions(); track s.familyId) {
            <li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{{ s.deviceInfo ?? 'Unknown device' }}</p>
                <p class="text-xs text-slate-500">
                  Last active {{ s.lastUsedAt | date: 'd MMM y, h:mm a' }} · expires
                  {{ s.expiresAt | date: 'd MMM y' }}
                </p>
              </div>
              @if (s.current) {
                <span
                  class="rounded-full bg-leaf-600/10 px-2 py-0.5 text-xs font-semibold text-leaf-600"
                  >This device</span
                >
              } @else {
                <button
                  type="button"
                  (click)="revoke(s.familyId)"
                  class="text-sm text-red-700 underline"
                >
                  Sign out
                </button>
              }
            </li>
          } @empty {
            <li class="px-4 py-3 text-sm text-slate-500">Loading devices…</li>
          }
        </ul>
      </section>
    </section>
  `,
})
export class Account implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly sessions = signal<SessionInfo[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly phone = signal('');
  protected readonly code = signal('');
  protected readonly codeSent = signal(false);
  protected readonly changingPhone = signal(false);
  protected readonly phoneBusy = signal(false);
  protected readonly phoneMessage = signal<{ text: string; error: boolean } | null>(null);

  async ngOnInit(): Promise<void> {
    this.phone.set(this.auth.user()?.phone ?? '');
    await this.load();
  }

  protected async send(): Promise<void> {
    if (!normalizeIndianMobile(this.phone())) {
      this.phoneMessage.set({ text: 'Enter a valid 10-digit Indian mobile number.', error: true });
      return;
    }
    this.phoneBusy.set(true);
    try {
      await this.auth.sendPhoneCode(this.phone());
      this.codeSent.set(true);
      this.code.set('');
      this.phoneMessage.set({
        text: 'We sent a 6-digit code by SMS. It expires in 5 minutes.',
        error: false,
      });
    } catch (err) {
      this.phoneMessage.set({ text: errorMessage(err, 'Could not send the code.'), error: true });
    } finally {
      this.phoneBusy.set(false);
    }
  }

  protected async verify(): Promise<void> {
    if (!/^\d{6}$/.test(this.code().trim())) {
      this.phoneMessage.set({ text: 'Enter the 6-digit code.', error: true });
      return;
    }
    this.phoneBusy.set(true);
    try {
      await this.auth.verifyPhoneCode(this.phone(), this.code().trim());
      this.codeSent.set(false);
      this.changingPhone.set(false);
      this.phoneMessage.set({ text: 'Your mobile number is verified.', error: false });
    } catch (err) {
      this.phoneMessage.set({ text: errorMessage(err, 'That code did not work.'), error: true });
    } finally {
      this.phoneBusy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.sessions.set((await this.auth.sessions()).sessions);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load your devices.'));
    }
  }

  protected async revoke(familyId: string): Promise<void> {
    await this.auth.revokeSession(familyId);
    await this.load();
  }

  protected async logoutAll(): Promise<void> {
    await this.auth.logoutAll();
  }
}
