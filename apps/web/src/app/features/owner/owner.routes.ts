import type { Routes } from '@angular/router';
import { withPermission } from '../../core/auth/guards';

export const OWNER_ROUTES: Routes = [
  {
    path: '',
    title: 'My venues · MandapamBook',
    loadComponent: () => import('./dashboard').then((m) => m.OwnerDashboard),
  },
  {
    path: 'profile',
    title: 'Business & payout details · MandapamBook',
    canMatch: [withPermission('kyc:update')],
    loadComponent: () => import('./profile').then((m) => m.OwnerProfile),
  },
  {
    path: 'staff',
    title: 'Staff · MandapamBook',
    canMatch: [withPermission('staff:manage')],
    loadComponent: () => import('./staff').then((m) => m.OwnerStaff),
  },
  {
    path: 'bookings',
    title: 'Bookings · MandapamBook',
    loadComponent: () => import('./bookings-inbox').then((m) => m.OwnerBookingsInbox),
  },
  {
    path: 'venues/new',
    title: 'Add a venue · MandapamBook',
    canMatch: [withPermission('auditorium:create')],
    loadComponent: () => import('./editor/venue-editor').then((m) => m.VenueNew),
  },
  {
    path: 'venues/:id',
    title: 'Edit venue · MandapamBook',
    loadComponent: () => import('./editor/venue-editor').then((m) => m.VenueEditor),
  },
];
