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
        else connectivity.navigationFailed.set(true);
      }),
    ),
    { provide: ErrorHandler, useClass: AppErrorHandler },
    // The wake interceptor is outermost, so a retried request goes through auth again.
    provideHttpClient(withFetch(), withInterceptors([serverWakeInterceptor, authInterceptor])),
    // Restore the session from the refresh cookie before the first navigation, but never
    // hold the page blank for long: if the API is still waking, the app shows its
    // "starting up" banner while signed-in pages wait in their guards (whenRestored).
    provideAppInitializer(() =>
      Promise.race([inject(AuthService).restore(), new Promise((r) => setTimeout(r, 4_000))]),
    ),
  ],
};
