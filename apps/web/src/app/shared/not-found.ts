import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="py-16 text-center">
      <h1 class="font-display text-3xl font-medium">Page not found</h1>
      <p class="mt-2 text-slate-600">The page you opened doesn't exist or has moved.</p>
      <a routerLink="/" class="mt-6 inline-block font-semibold text-brand-700 underline">
        Go to search
      </a>
    </section>
  `,
})
export class NotFound {}
