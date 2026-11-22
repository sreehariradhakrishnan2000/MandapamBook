import type { Routes } from '@angular/router';
import { signedOut } from '../../core/auth/guards';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    title: 'Sign in · MandapamBook',
    canMatch: [signedOut],
    loadComponent: () => import('./login').then((m) => m.Login),
  },
  {
    path: 'register',
    title: 'Create account · MandapamBook',
    canMatch: [signedOut],
    loadComponent: () => import('./register').then((m) => m.Register),
  },
  {
    path: 'verify-email',
    title: 'Verify email · MandapamBook',
    loadComponent: () => import('./email-actions').then((m) => m.VerifyEmail),
  },
  {
    path: 'forgot-password',
    title: 'Reset password · MandapamBook',
    loadComponent: () => import('./email-actions').then((m) => m.ForgotPassword),
  },
  {
    path: 'reset-password',
    title: 'Choose a new password · MandapamBook',
    loadComponent: () => import('./email-actions').then((m) => m.ResetPassword),
  },
];
