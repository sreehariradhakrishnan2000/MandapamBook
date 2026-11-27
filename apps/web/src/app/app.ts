import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, NavigationStart, Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { PaymentsService } from './core/payments.service';
import { Connectivity } from './core/connectivity';
import { ServerStatus } from './core/server-status';
import { MaintenancePage } from './shared/maintenance-page';
import { SHOW_WAKE_BANNER } from './core/site-flags';
import { RefundNotice } from './shared/refund-notice';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, MaintenancePage, RefundNotice],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly payments = inject(PaymentsService);
  protected readonly server = inject(ServerStatus);
  protected readonly net = inject(Connectivity);
  /** See core/site-flags.ts: the "starting up the server" bar is switched off for now. */
  protected readonly showWakeBanner = SHOW_WAKE_BANNER;
  /** The phone menu (below md); the header shows its links inline on wider screens. */
  protected readonly menuOpen = signal(false);
  private readonly url = signal('/');

  /** Admins keep using the site during maintenance (the API lets them through too). */
  protected readonly isStaff = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
  });

  /** Everyone else sees the maintenance page, except on sign-in so staff can get in. */
  protected readonly showMaintenance = computed(
    () => this.server.maintenance() !== null && !this.isStaff() && !this.url().startsWith('/login'),
  );

  /** "Thu 27 Nov, 11:00 pm – 12:00 am" for an announced window, unless it is under way. */
  protected readonly scheduleText = computed(() => {
    const s = this.server.scheduled();
    if (!s || this.server.maintenance()) return null;
    return scheduleLabel(s.from, s.to);
  });

  constructor() {
    const router = inject(Router);
    void this.payments.loadConfig();
    void this.server.checkMaintenance();
    const sub = router.events.subscribe((e) => {
      // Close the phone menu as soon as one of its links starts a navigation.
      if (e instanceof NavigationStart) this.menuOpen.set(false);
      if (e instanceof NavigationEnd) {
        this.url.set(e.urlAfterRedirects);
        // A page that loaded fine clears an earlier "couldn't load" message.
        this.net.navigationFailed.set(false);
      }
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }
  protected readonly year = new Date().getFullYear();

  protected signOut(): void {
    this.menuOpen.set(false);
    void this.auth.logout();
  }
}

const IST = 'Asia/Kolkata';
const day = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: IST,
});
const time = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: IST,
});

/** A maintenance window in India time; the day is repeated only if it ends on another day. */
export function scheduleLabel(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const sameDay = day.format(from) === day.format(to);
  return sameDay
    ? `${day.format(from)}, ${time.format(from)} – ${time.format(to)}`
    : `${day.format(from)}, ${time.format(from)} – ${day.format(to)}, ${time.format(to)}`;
}
