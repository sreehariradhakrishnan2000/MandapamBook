import type { Routes } from '@angular/router';
import { PlaceholderPage } from '../../shared/placeholder-page';

export const CUSTOMER_ROUTES: Routes = [
  {
    path: '',
    title: 'Your account · MandapamBook',
    loadComponent: () => import('./account').then((m) => m.Account),
  },
  {
    path: 'bookings',
    title: 'My bookings · MandapamBook',
    component: PlaceholderPage,
    data: {
      heading: 'My bookings',
      description: 'Your bookings, payments and invoices will appear here.',
    },
  },
];
