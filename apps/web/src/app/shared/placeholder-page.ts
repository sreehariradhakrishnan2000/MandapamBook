import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Temporary page used by role areas until their phase lands. */
@Component({
  selector: 'app-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="py-12">
      <h1 class="font-display text-2xl font-bold">{{ heading() }}</h1>
      <p class="mt-2 max-w-prose text-slate-600">{{ description() }}</p>
    </section>
  `,
})
export class PlaceholderPage {
  readonly heading = input.required<string>();
  readonly description = input.required<string>();
}
