import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withNavigationErrorHandler,
} from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { serverWakeInterceptor } from './core/server-status';
import { AppErrorHandler } from './core/app-error-handler';
import { Connectivity, isChunkLoadError } from './core/connectivity';
import { ErrorTracking } from './core/error-tracking';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      // A page that cannot load: after a release that's a stale tab, otherwise a real error.
      withNavigationErrorHandler((e) => {
        const connectivity = inject(Connectivity);
        if (isChunkLoadError(e.error)) connectivity.updateAvailable.set(true);
        else {
          inject(ErrorTracking).capture(e.error);
          connectivity.navigationFailed.set(true);
        }
      }),
    ),
    { provide: ErrorHandler, useClass: AppErrorHandler },
    // The wake interceptor is outermost, so a retried request goes through auth again.
    provideHttpClient(withFetch(), withInterceptors([serverWakeInterceptor, authInterceptor])),
    // Restore the session from the refresh cookie. Only someone signed in last time waits
    // for it before the first paint (so the header shows their account at once), and never
    // longer than 4 s. Everyone else gets the page immediately while it runs in the
    // background; signed-in pages wait in their guards (whenRestored) either way.
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      const restoring = auth.restore();
      if (!auth.likelySignedIn) return;
      return Promise.race([restoring, new Promise((r) => setTimeout(r, 4_000))]);
    }),
  ],
};
