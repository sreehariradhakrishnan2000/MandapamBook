import { inject } from '@angular/core';
import { type CanMatchFn, Router, type UrlSegment, type UrlTree } from '@angular/router';
import type { Permission } from '@mandapambook/shared';
import { AuthService } from './auth.service';

/**
 * Route guards decide what to show; they are a convenience, not security. Every API call
 * is authorised again on the server. Each guard first waits for the startup session check,
 * which can take up to a minute while the API wakes, so nobody is wrongly sent to sign in.
 */
function toLogin(router: Router, segments: UrlSegment[]): UrlTree {
  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
}

export const signedIn: CanMatchFn = async (_route, segments) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenRestored();
  return auth.isSignedIn() ? true : toLogin(router, segments);
};

export function withPermission(permission: Permission): CanMatchFn {
  return async (_route, segments) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.whenRestored();
    if (!auth.isSignedIn()) return toLogin(router, segments);
    return auth.hasPermission(permission) ? true : router.createUrlTree(['/']);
  };
}

/** Keeps signed-in users away from the sign-in and register pages. */
export const signedOut: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenRestored();
  return auth.isSignedIn() ? router.createUrlTree(['/']) : true;
};
