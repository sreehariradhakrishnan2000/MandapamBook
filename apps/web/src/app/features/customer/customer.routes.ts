import type { Routes } from '@angular/router';

export const CUSTOMER_ROUTES: Routes = [
  {
    path: '',
    title: 'Your account · MandapamBook',
    loadComponent: () => import('./account').then((m) => m.Account),
  },
  {
    path: 'bookings',
    title: 'My bookings · MandapamBook',
    loadComponent: () => import('./bookings').then((m) => m.MyBookings),
  },
  {
    path: 'bookings/:id',
    title: 'Booking · MandapamBook',
    loadComponent: () => import('./bookings').then((m) => m.BookingDetailPage),
  },
];
