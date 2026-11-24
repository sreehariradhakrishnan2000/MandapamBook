import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SearchQuery, SearchResult } from '@mandapambook/shared';
import { BookingApi } from '../../core/booking-api.service';
import { HallCard } from '../../shared/hall-card';
import { SearchForm } from './search-form';

type Sort = NonNullable<SearchQuery['sort']>;

/*
 * Photos are from Unsplash (Unsplash License), resized and served from /images:
 * mandap photo-1587271636175, arches photo-1761472606347, reception-hall photo-1779308936221,
 * ballroom photo-1712314947761, garden-stage photo-1744805624954, marigold photo-1789971649652.
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink, HallCard, SearchForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-3xl pt-6 text-center sm:pt-10">
      <h1 class="font-display text-4xl leading-[1.1] font-normal text-balance sm:text-6xl">
        Book the right mandapam for your muhurtham
      </h1>
      <p class="mx-auto mt-4 max-w-xl text-lg text-slate-600">
        Compare kalyana mandapams and convention halls by city, guests, catering and price, then
        hold your date while you pay.
      </p>
    </section>

    <div class="mx-auto mt-8 max-w-5xl">
      <app-search-form />
    </div>

    <!-- Two large photo cards, as in a travel magazine. -->
    <section aria-label="Get started" class="mt-12 grid gap-5 md:grid-cols-2">
      @for (c of heroCards; track c.title) {
        <div class="photo-scrim relative isolate overflow-hidden rounded-3xl">
          <img
            [src]="c.image"
            alt=""
            class="aspect-[4/3] w-full object-cover sm:aspect-[16/11]"
            [attr.fetchpriority]="$first ? 'high' : null"
          />
          <div class="absolute inset-x-0 bottom-0 z-10 p-6 sm:p-8">
            <h2 class="max-w-xs font-display text-3xl leading-tight text-white sm:text-4xl">
              {{ c.title }}
            </h2>
            <a
              [routerLink]="c.link"
              class="mt-4 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-cream"
              >{{ c.cta }}</a
            >
          </div>
        </div>
      }
    </section>

    <section aria-labelledby="occasion-h" class="mt-20">
      <h2 id="occasion-h" class="section-title">Plan by occasion</h2>
      <p class="mt-2 text-slate-600">Jump straight to halls that suit the day you have in mind.</p>
      <ul class="mt-6 grid gap-5 sm:grid-cols-3">
        @for (o of occasions; track o.title) {
          <li>
            <a
              routerLink="/search"
              [queryParams]="o.query"
              class="photo-scrim scrim-top group relative isolate block overflow-hidden rounded-2xl"
            >
              <img
                [src]="o.image"
                alt=""
                loading="lazy"
                class="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <span class="absolute inset-0 z-10 flex flex-col justify-between p-5 text-white">
                <span class="font-display text-2xl leading-tight uppercase">{{ o.title }}</span>
                <span>
                  <span class="block text-sm">{{ o.text }}</span>
                  <span
                    class="mt-2 inline-block rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-brand-700"
                    >{{ o.tag }}</span
                  >
                </span>
              </span>
            </a>
          </li>
        }
      </ul>
    </section>

    @if (popularState() !== 'hidden') {
      <section aria-labelledby="popular-h" class="mt-20">
        <div class="text-center">
          <h2 id="popular-h" class="section-title text-balance">
            Find the perfect hall for your big day
          </h2>
          <p class="mt-2 text-slate-600">
            Verified venues with real photos, capacities and prices.
          </p>
        </div>
        <div class="mt-6 flex flex-wrap justify-center gap-2" role="group" aria-label="Sort halls">
          @for (s of sorts; track s.value) {
            <button
              type="button"
              class="chip"
              [attr.aria-pressed]="sort() === s.value"
              (click)="sort.set(s.value)"
            >
              {{ s.label }}
            </button>
          }
        </div>
        <ul class="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
          @if (popularState() === 'loading' && !popular().length) {
            @for (i of [1, 2, 3, 4]; track i) {
              <li class="h-80 animate-pulse rounded-2xl bg-slate-100" aria-hidden="true"></li>
            }
          }
          @for (v of popular(); track v.id) {
            <li><app-hall-card [venue]="v" /></li>
          }
        </ul>
        <p class="mt-8 text-center">
          <a
            routerLink="/search"
            class="inline-flex rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold hover:border-slate-400"
            >See all halls</a
          >
        </p>
      </section>
    }

    <section
      aria-labelledby="owners-h"
      class="mt-20 grid items-center gap-8 overflow-hidden rounded-3xl bg-forest-800 p-6 text-forest-100 sm:p-10 md:grid-cols-[1.2fr_1fr]"
    >
      <div>
        <h2 id="owners-h" class="font-display text-3xl leading-tight text-white sm:text-4xl">
          Own a mandapam? Fill your calendar.
        </h2>
        <ul class="mt-6 flex flex-col gap-3">
          @for (p of ownerPoints; track p) {
            <li class="flex items-start gap-3">
              <span
                class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 16 16"
                  class="size-3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                >
                  <path d="m3.5 8.5 3 3 6-7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              {{ p }}
            </li>
          }
        </ul>
        <a
          routerLink="/register"
          class="mt-8 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-forest-800 hover:bg-forest-50"
          >List your venue</a
        >
      </div>
      <img
        src="images/marigold.webp"
        alt=""
        loading="lazy"
        class="hidden h-72 w-full rounded-2xl object-cover md:block"
      />
    </section>

    @if (cities().length) {
      <section aria-labelledby="cities-h" class="mt-20">
        <h2 id="cities-h" class="section-title">Wedding halls by city</h2>
        <ul class="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          @for (c of cities(); track c.slug) {
            <li>
              <a routerLink="/search" [queryParams]="{ city: c.slug }" class="group block">
                <span class="block text-sm font-medium text-ink group-hover:underline">{{
                  c.name
                }}</span>
                <span class="block text-xs text-slate-500">{{ c.state }}</span>
              </a>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class Home {
  private readonly api = inject(BookingApi);

  protected readonly heroCards = [
    {
      title: 'Every ritual, the right hall.',
      cta: 'Browse halls',
      link: '/search',
      image: 'images/mandap.webp',
    },
    {
      title: 'Own a mandapam? List it here.',
      cta: 'List your venue',
      link: '/register',
      image: 'images/arches.webp',
    },
  ];

  protected readonly occasions = [
    {
      title: 'Evening receptions',
      text: 'Lawns and halls lit for the night',
      tag: 'Reception slot',
      query: { slot: 'EVENING' },
      image: 'images/garden-stage.webp',
    },
    {
      title: 'Full-day weddings',
      text: 'Muhurtham to reception, one booking',
      tag: 'Full day',
      query: { slot: 'FULL_DAY' },
      image: 'images/reception-hall.webp',
    },
    {
      title: 'Grand halls',
      text: 'Room for a thousand guests and more',
      tag: '1,000+ guests',
      query: { guests: 1000 },
      image: 'images/ballroom.webp',
    },
  ];

  protected readonly sorts: { value: Sort; label: string }[] = [
    { value: 'recommended', label: 'Popular' },
    { value: 'rating', label: 'Top rated' },
    { value: 'capacity', label: 'Largest' },
    { value: 'price_asc', label: 'Best value' },
  ];

  protected readonly ownerPoints = [
    'Every owner and venue is verified before going live',
    'One calendar for muhurtham, reception and full-day slots',
    'Advance payments, invoices and reviews handled for you',
  ];

  protected readonly sort = signal<Sort>('recommended');
  protected readonly popular = signal<SearchResult[]>([]);
  /** 'hidden' when there are no venues yet or the API is unreachable. */
  protected readonly popularState = signal<'loading' | 'ready' | 'hidden'>('loading');
  protected readonly cities = signal<{ slug: string; name: string; state: string }[]>([]);

  constructor() {
    void this.api.cities().then(
      (c) => this.cities.set(c.items),
      () => undefined,
    );
    // Only the chip choice may re-run this: loadPopular reads and writes popularState before
    // its first await, and tracking that would reload the list in an endless loop.
    effect(() => {
      const sort = this.sort();
      untracked(() => void this.loadPopular(sort));
    });
  }

  private async loadPopular(sort: Sort): Promise<void> {
    if (this.popularState() !== 'hidden') this.popularState.set('loading');
    try {
      const res = await this.api.search({ sort, page: 1, pageSize: 4 } as SearchQuery);
      if (sort !== this.sort()) return; // a newer chip was clicked meanwhile
      this.popular.set(res.items);
      this.popularState.set(res.items.length || sort !== 'recommended' ? 'ready' : 'hidden');
    } catch {
      if (!this.popular().length) this.popularState.set('hidden');
    }
  }
}
