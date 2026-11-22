import type { Routes } from '@angular/router';

export const PUBLIC_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'MandapamBook · Book wedding halls and kalyana mandapams',
    loadComponent: () => import('./home').then((m) => m.Home),
  },
];
