import type { Routes } from '@angular/router';
import { PlaceholderPage } from '../../shared/placeholder-page';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    title: 'Admin · MandapamBook',
    component: PlaceholderPage,
    data: {
      heading: 'Admin console',
      description: 'Listing approvals, users, bookings, refunds and reports will live here.',
    },
  },
];
