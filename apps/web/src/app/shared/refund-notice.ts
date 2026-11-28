import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { BookingApi, type RefundUpdate } from '../core/booking-api.service';
import { InrPipe } from './inr.pipe';

const SEEN_KEY = 'mb:refund-notices-seen';

/** Notices the customer closed: "<bookingId>:<status>". Storage can be unavailable. */
function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Shown at the top of every page to a signed-in customer whose refund is under way, and
 * for two weeks after it completes, so they never have to go looking for their money.
 * Closing one hides it until its status changes (a closed "in progress" notice comes back
 * as "completed").
 */
@Component({
  selector: 'app-refund-notice',
  imports: [RouterLink, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (u of visible(); track u.bookingId) {
      <div
        class="mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm"
        [class]="
          u.refund.status === 'COMPLETED'
            ? 'border-forest-200 bg-forest-50 text-forest-900'
            : 'border-marigold-300 bg-marigold-100/60 text-slate-900'
        "
        role="status"
      >
        <span class="mt-0.5 text-base leading-none" aria-hidden="true">{{
          u.refund.status === 'COMPLETED' ? '✓' : '↻'
        }}</span>
        <p class="flex-1">
          @if (u.refund.status === 'COMPLETED') {
            <strong>Your refund of {{ u.refund.amountPaise | inr }} is complete.</strong>
            It was sent back to your original payment method for booking {{ u.refCode }}.
          } @else {
            <strong>Your refund of {{ u.refund.amountPaise | inr }} is being processed.</strong>
            It goes back to your original payment method for booking {{ u.refCode }}, usually within
            minutes.
          }
          <a
            [routerLink]="['/account/bookings', u.bookingId]"
            class="ml-1 font-semibold whitespace-nowrap text-brand-700 underline"
            >View details</a
          >
        </p>
        <button
          type="button"
          class="tap -my-1 rounded-full px-2 text-lg leading-none text-slate-500 hover:text-slate-800"
          [attr.aria-label]="'Hide this refund notice for booking ' + u.refCode"
          (click)="hide(u)"
        >
          ×
        </button>
      </div>
    }
  `,
})
export class RefundNotice {
  private readonly auth = inject(AuthService);
  private readonly api = inject(BookingApi);
  private readonly updates = signal<RefundUpdate[]>([]);
  private readonly seen = signal(readSeen());
  private readonly url = toSignal(
    inject(Router).events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: '' },
  );

  private readonly onAccount = computed(() => this.url().startsWith('/account'));

  /** At most two, and never on the booking page that already shows the full status. */
  protected readonly visible = computed(() =>
    this.updates()
      .filter((u) => !this.seen().has(`${u.bookingId}:${u.refund.status}`))
      .filter((u) => !this.url().startsWith(`/account/bookings/${u.bookingId}`))
      .slice(0, 2),
  );

  constructor() {
    // Load for customers when they sign in (or the page opens signed in), and again on
    // each visit to their bookings, where a status may just have changed.
    effect(() => {
      const user = this.auth.user();
      this.onAccount(); // re-runs only when entering or leaving the account pages
      if (!user || !this.auth.hasPermission('booking:create')) {
        this.updates.set([]);
        return;
      }
      void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      this.updates.set((await this.api.refundUpdates()).items);
    } catch {
      // A notice is a convenience; the booking page still shows the refund.
    }
  }

  protected hide(u: RefundUpdate): void {
    const next = new Set(this.seen()).add(`${u.bookingId}:${u.refund.status}`);
    this.seen.set(next);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-50)));
    } catch {
      // Private mode: hidden for this visit only.
    }
  }
}
