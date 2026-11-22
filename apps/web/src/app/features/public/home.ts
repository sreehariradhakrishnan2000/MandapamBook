import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SearchForm } from './search-form';

@Component({
  selector: 'app-home',
  imports: [SearchForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-6 py-6 sm:py-12">
      <div>
        <h1
          class="max-w-2xl font-display text-3xl font-extrabold tracking-tight text-balance sm:text-5xl"
        >
          Book the right mandapam for your muhurtham
        </h1>
        <p class="mt-4 max-w-xl text-lg text-slate-600">
          Compare kalyana mandapams and convention halls by city, guest capacity, catering policy
          and price, then hold your date while you pay.
        </p>
      </div>
      <app-search-form />
    </section>
  `,
})
export class Home {}
