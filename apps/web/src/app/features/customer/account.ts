import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
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

  async ngOnInit(): Promise<void> {
    await this.load();
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
