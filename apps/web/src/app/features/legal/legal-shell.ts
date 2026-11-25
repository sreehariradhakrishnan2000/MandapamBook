import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL } from './legal-info';

/** The shared layout of the legal pages: a readable column with the site's typography. */
@Component({
  selector: 'app-legal-shell',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="legal mx-auto max-w-3xl py-4">
      <p class="text-sm font-semibold uppercase tracking-wide text-brand-700">Legal</p>
      <h1 class="mt-1 font-display text-4xl font-normal text-ink">{{ heading() }}</h1>
      <p class="mt-2 text-sm text-slate-500">Last updated {{ updated }}</p>
      <nav aria-label="Legal pages" class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a routerLink="/terms" class="tap text-brand-700 underline">Terms of Use</a>
        <a routerLink="/privacy" class="tap text-brand-700 underline">Privacy Policy</a>
        <a routerLink="/refund-policy" class="tap text-brand-700 underline"
          >Refund &amp; Cancellation</a
        >
        <a routerLink="/contact" class="tap text-brand-700 underline">Contact us</a>
      </nav>
      <div class="mt-8 rounded-3xl border border-slate-200 bg-white px-5 py-8 sm:px-10">
        <ng-content />
      </div>
    </article>
  `,
  styles: `
    :host ::ng-deep .legal h2 {
      font-family: var(--font-display);
      font-size: 1.5rem;
      font-weight: 400;
      color: var(--color-ink);
      margin: 2rem 0 0.75rem;
      scroll-margin-top: 1rem;
    }
    :host ::ng-deep .legal h2:first-child {
      margin-top: 0;
    }
    :host ::ng-deep .legal h3 {
      font-weight: 600;
      color: var(--color-ink);
      margin: 1.25rem 0 0.5rem;
    }
    :host ::ng-deep .legal p,
    :host ::ng-deep .legal li {
      color: var(--color-slate-700);
      line-height: 1.7;
    }
    :host ::ng-deep .legal p + p {
      margin-top: 0.75rem;
    }
    :host ::ng-deep .legal ul {
      list-style: disc;
      padding-left: 1.25rem;
      margin: 0.5rem 0;
    }
    :host ::ng-deep .legal li + li {
      margin-top: 0.35rem;
    }
    :host ::ng-deep .legal a {
      color: var(--color-brand-700);
      text-decoration: underline;
    }
  `,
})
export class LegalShell {
  readonly heading = input.required<string>();
  protected readonly updated = LEGAL.lastUpdated;
}
