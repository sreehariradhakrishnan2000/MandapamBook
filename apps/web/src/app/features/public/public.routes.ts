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
  {
    path: 'terms',
    title: 'Terms of Use · MandapamBook',
    loadComponent: () => import('../legal/terms').then((m) => m.Terms),
  },
  {
    path: 'privacy',
    title: 'Privacy Policy · MandapamBook',
    loadComponent: () => import('../legal/privacy').then((m) => m.Privacy),
  },
  {
    path: 'refund-policy',
    title: 'Refund & Cancellation Policy · MandapamBook',
    loadComponent: () => import('../legal/refund-policy').then((m) => m.RefundPolicy),
  },
  {
    path: 'contact',
    title: 'Contact us · MandapamBook',
    loadComponent: () => import('../legal/contact').then((m) => m.Contact),
  },
  {
    path: 'payments/return',
    title: 'Payment · MandapamBook',
    loadComponent: () => import('../payments/payment-return').then((m) => m.PaymentReturn),
  },
];
