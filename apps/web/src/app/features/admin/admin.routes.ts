import type { Routes } from '@angular/router';
import { withPermission } from '../../core/auth/guards';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    title: 'Admin · MandapamBook',
    loadComponent: () => import('./admin-home').then((m) => m.AdminHome),
  },
  {
    path: 'listings',
    title: 'Listing approvals · MandapamBook',
    canMatch: [withPermission('listing:review')],
    loadComponent: () => import('./listings').then((m) => m.AdminListings),
  },
  {
    path: 'listings/:id',
    title: 'Review listing · MandapamBook',
    canMatch: [withPermission('listing:review')],
    loadComponent: () => import('./listings').then((m) => m.AdminListingReview),
  },
  {
    path: 'owners',
    title: 'Owner KYC · MandapamBook',
    canMatch: [withPermission('kyc:review')],
    loadComponent: () => import('./owners-kyc').then((m) => m.AdminOwnersKyc),
  },
  {
    path: 'users',
    title: 'Users · MandapamBook',
    canMatch: [withPermission('user:manage')],
    loadComponent: () => import('./users').then((m) => m.AdminUsers),
  },
  {
    path: 'master-data',
    title: 'Reference data · MandapamBook',
    canMatch: [withPermission('masterdata:update')],
    loadComponent: () => import('./settings').then((m) => m.AdminMasterData),
  },
  {
    path: 'settings',
    title: 'Platform settings · MandapamBook',
    canMatch: [withPermission('report:view')],
    loadComponent: () => import('./settings').then((m) => m.AdminSettings),
  },
  {
    path: 'reports',
    title: 'Reports · MandapamBook',
    canMatch: [withPermission('report:view')],
    loadComponent: () => import('./insights').then((m) => m.AdminReports),
  },
  {
    path: 'payouts',
    title: 'Owner payouts · MandapamBook',
    canMatch: [withPermission('payout:manage')],
    loadComponent: () => import('./insights').then((m) => m.AdminPayouts),
  },
  {
    path: 'reviews',
    title: 'Review moderation · MandapamBook',
    canMatch: [withPermission('review:moderate')],
    loadComponent: () => import('./insights').then((m) => m.AdminReviews),
  },
  {
    path: 'audit',
    title: 'Audit log · MandapamBook',
    canMatch: [withPermission('audit:view')],
    loadComponent: () => import('./settings').then((m) => m.AdminAudit),
  },
];
