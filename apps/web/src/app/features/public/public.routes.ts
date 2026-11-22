import type { Routes } from '@angular/router';

export const PUBLIC_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'MandapamBook · Book wedding halls and kalyana mandapams',
    loadComponent: () => import('./home').then((m) => m.Home),
  },
  {
    path: 'search',
    title: 'Find a hall · MandapamBook',
    loadComponent: () => import('./search').then((m) => m.Search),
  },
  {
    path: 'venues/:slug',
    title: 'Venue · MandapamBook',
    loadComponent: () => import('./venue').then((m) => m.Venue),
  },
  {
    path: 'book/:hallId',
    title: 'Book a hall · MandapamBook',
    loadComponent: () => import('../booking/book').then((m) => m.Book),
  },
];
