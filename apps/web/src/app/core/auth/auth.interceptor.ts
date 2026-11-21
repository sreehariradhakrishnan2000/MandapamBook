import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { type Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { API, AuthService } from './auth.service';

/** Auth endpoints that must never trigger a refresh-and-retry loop. */
const NO_RETRY = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/csrf', '/auth/register'];

/**
 * Attaches the in-memory access token to API calls only (never to third-party URLs),
 * and on a 401 refreshes once and retries the original request.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API)) return next(req);
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(withToken(req, auth.accessToken)).pipe(
    catchError((err: unknown) => {
      const retryable =
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !NO_RETRY.some((path) => req.url.includes(path));
      if (!retryable) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((ok): Observable<HttpEvent<unknown>> => {
          if (!ok) {
            auth.clear();
            void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
            return throwError(() => err);
          }
          return next(withToken(req, auth.accessToken));
        }),
      );
    }),
  );
};

function withToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}
