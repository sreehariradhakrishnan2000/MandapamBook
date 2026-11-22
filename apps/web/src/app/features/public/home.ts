import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="py-10 sm:py-16">
      <h1
        class="max-w-2xl font-display text-3xl font-extrabold tracking-tight text-balance sm:text-5xl"
      >
        Book the right mandapam for your muhurtham
      </h1>
      <p class="mt-4 max-w-xl text-lg text-slate-600">
        Compare kalyana mandapams and convention halls by city, guest capacity, catering policy and
        price, then hold your date while you pay.
      </p>
      <p class="mt-8 inline-block rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">
        Search opens in a later release.
      </p>
    </section>
  `,
})
export class Home {}
