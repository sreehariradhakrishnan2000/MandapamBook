import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrowserNavigation } from '../core/browser-navigation';
import { ServerStatus } from '../core/server-status';

/** How often the page asks whether maintenance is over. */
export const MAINTENANCE_POLL_SECONDS = 30;

/**
 * Shown instead of the site while planned maintenance is on. It checks every 30 seconds
 * and reloads the page the visitor was on as soon as the site is back.
 */
@Component({
  selector: 'app-maintenance-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      id="main"
      class="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-cream px-4 py-16 text-center"
    >
      <!-- Soft marigold glow behind the card, in the site's colours. -->
      <div
        aria-hidden="true"
        class="pointer-events-none absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-marigold-200/40 blur-3xl"
      ></div>

      <section
        class="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white px-6 py-10 shadow-[0_24px_48px_-28px_rgb(28_25_23/0.25)] sm:px-10"
        aria-labelledby="maintenance-heading"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 32 32"
          class="mx-auto size-16 motion-safe:animate-[sway_4s_ease-in-out_infinite]"
        >
          <path d="M16 3c-3 0-5 2-5 4 2-1 3-1 5-1s3 0 5 1c0-2-2-4-5-4z" fill="#2b5d48" />
          <circle cx="16" cy="6.5" r="2.6" fill="#f6b73c" />
          <path d="M10 10h12l-1 2H11z" fill="#e89b12" />
          <path
            d="M9.5 12h13c2.5 2.5 3.5 5.5 3 8.5-.6 4-4.4 7.5-9.5 7.5s-8.9-3.5-9.5-7.5c-.5-3 .5-6 3-8.5z"
            fill="#c2410c"
          />
          <path d="M8 19h16" stroke="#f6b73c" stroke-width="1.6" />
        </svg>

        <p class="mt-4 font-display text-lg text-slate-600">MandapamBook</p>
        <h1
          id="maintenance-heading"
          class="mt-2 font-display text-3xl font-normal text-ink sm:text-4xl"
        >
          We're making things better
        </h1>
        <p class="mt-4 text-base leading-relaxed text-slate-700">{{ message() }}</p>

        @if (backBy(); as time) {
          <p
            class="mx-auto mt-6 w-fit rounded-full bg-forest-50 px-4 py-2 text-sm font-semibold text-forest-800 ring-1 ring-forest-200"
          >
            Expected back by {{ time }}
          </p>
        }

        <p class="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500" role="status">
          <span
            class="size-3.5 rounded-full border-2 border-brand-600 border-t-transparent motion-safe:animate-spin"
            aria-hidden="true"
          ></span>
          @if (checking()) {
            Checking…
          } @else {
            This page refreshes by itself when we're back.
          }
        </p>

        <p class="mt-6 text-sm text-slate-600">
          Your bookings and payments are safe. Nothing you've booked is affected.
        </p>
      </section>

      <p class="relative mt-10 font-display text-base text-brand-700">
        Shubh Vivah · ശുഭ വിവാഹം · शुभ विवाह
      </p>
      <a routerLink="/login" class="tap relative mt-2 text-xs text-slate-500 underline"
        >Staff sign in</a
      >
    </main>
  `,
  styles: `
    @keyframes sway {
      0%,
      100% {
        transform: rotate(-4deg);
      }
      50% {
        transform: rotate(4deg);
      }
    }
  `,
})
export class MaintenancePage {
  private readonly server = inject(ServerStatus);
  private readonly navigation = inject(BrowserNavigation);
  protected readonly checking = signal(false);

  protected readonly message = computed(
    () =>
      this.server.maintenance()?.message ||
      "We're doing some planned maintenance on MandapamBook. We'll be back shortly.",
  );

  /** "3:30 pm, Thu 27 Nov" in India time, or null when no end time was given. */
  protected readonly backBy = computed(() => {
    const until = this.server.maintenance()?.until;
    if (!until || Number.isNaN(Date.parse(until))) return null;
    return new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(until));
  });

  constructor() {
    const timer = setInterval(() => void this.check(), MAINTENANCE_POLL_SECONDS * 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async check(): Promise<void> {
    this.checking.set(true);
    try {
      const stillOn = await this.server.checkMaintenance();
      // Back: reload so the page the visitor was on fetches its data again.
      if (!stillOn) this.navigation.reload();
    } finally {
      this.checking.set(false);
    }
  }
}
