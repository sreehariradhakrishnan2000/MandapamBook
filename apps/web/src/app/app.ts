import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { NavigationStart, Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { PaymentsService } from './core/payments.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly payments = inject(PaymentsService);
  /** The phone menu (below md); the header shows its links inline on wider screens. */
  protected readonly menuOpen = signal(false);

  constructor() {
    void this.payments.loadConfig();
    // Close the phone menu as soon as one of its links starts a navigation.
    const sub = inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationStart) this.menuOpen.set(false);
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }
  protected readonly year = new Date().getFullYear();

  protected signOut(): void {
    this.menuOpen.set(false);
    void this.auth.logout();
  }
}
