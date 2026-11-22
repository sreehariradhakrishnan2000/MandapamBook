import type { Routes } from '@angular/router';
import { PlaceholderPage } from '../../shared/placeholder-page';

export const OWNER_ROUTES: Routes = [
  {
    path: '',
    title: 'Owner dashboard · MandapamBook',
    component: PlaceholderPage,
    data: {
      heading: 'List your venue',
      description:
        'Venue owners will register, add halls, set pricing and manage booking requests here.',
    },
  },
];
