import type { Routes } from '@angular/router';

/**
 * Each role area is a lazy-loaded route tree so customers never download
 * owner/admin code. Role guards are added with auth in Phase 2.
 */
export const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./features/public/public.routes').then((m) => m.PUBLIC_ROUTES),
  },
  {
    path: 'account',
    loadChildren: () =>
      import('./features/customer/customer.routes').then((m) => m.CUSTOMER_ROUTES),
  },
  {
    path: 'owner',
    loadChildren: () => import('./features/owner/owner.routes').then((m) => m.OWNER_ROUTES),
  },
  {
    path: 'admin',
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: '**',
    title: 'Page not found · MandapamBook',
    loadComponent: () => import('./shared/not-found').then((m) => m.NotFound),
  },
];
