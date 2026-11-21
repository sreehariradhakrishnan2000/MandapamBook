import { inject } from '@angular/core';
import { type CanMatchFn, Router, type UrlSegment, type UrlTree } from '@angular/router';
import type { Permission } from '@mandapambook/shared';
import { AuthService } from './auth.service';

/**
 * Route guards decide what to show; they are a convenience, not security. Every API call
 * is authorised again on the server.
 */
function toLogin(router: Router, segments: UrlSegment[]): UrlTree {
  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
}

export const signedIn: CanMatchFn = (_route, segments) =>
  inject(AuthService).isSignedIn() ? true : toLogin(inject(Router), segments);

export function withPermission(permission: Permission): CanMatchFn {
  return (_route, segments) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isSignedIn()) return toLogin(router, segments);
    return auth.hasPermission(permission) ? true : router.createUrlTree(['/']);
  };
}

/** Keeps signed-in users away from the sign-in and register pages. */
export const signedOut: CanMatchFn = () =>
  inject(AuthService).isSignedIn() ? inject(Router).createUrlTree(['/']) : true;
