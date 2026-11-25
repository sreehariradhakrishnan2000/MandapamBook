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
import { ServerStatus } from './core/server-status';
import { MaintenancePage } from './shared/maintenance-page';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, MaintenancePage],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly payments = inject(PaymentsService);
  protected readonly server = inject(ServerStatus);
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

  constructor() {
    const router = inject(Router);
    void this.payments.loadConfig();
    void this.server.checkMaintenance();
    const sub = router.events.subscribe((e) => {
      // Close the phone menu as soon as one of its links starts a navigation.
      if (e instanceof NavigationStart) this.menuOpen.set(false);
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects);
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }
  protected readonly year = new Date().getFullYear();

  protected signOut(): void {
    this.menuOpen.set(false);
    void this.auth.logout();
  }
}
