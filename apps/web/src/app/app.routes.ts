import type { Routes } from '@angular/router';
import { signedIn, withPermission } from './core/auth/guards';

/**
 * Each role area is a lazy-loaded route tree so customers never download
 * owner/admin code. Guards only shape navigation; the API enforces access.
 */
export const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: '',
    loadChildren: () => import('./features/public/public.routes').then((m) => m.PUBLIC_ROUTES),
  },
  {
    path: 'account',
    canMatch: [signedIn],
    loadChildren: () =>
      import('./features/customer/customer.routes').then((m) => m.CUSTOMER_ROUTES),
  },
  {
    path: 'owner',
    canMatch: [withPermission('booking:view_venue')],
    loadChildren: () => import('./features/owner/owner.routes').then((m) => m.OWNER_ROUTES),
  },
  {
    path: 'admin',
    canMatch: [withPermission('audit:view')],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: '**',
    title: 'Page not found · MandapamBook',
    loadComponent: () => import('./shared/not-found').then((m) => m.NotFound),
  },
];
