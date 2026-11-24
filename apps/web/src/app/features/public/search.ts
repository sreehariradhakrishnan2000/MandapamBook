import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  type Coordinates,
  DEFAULT_SEARCH_RADIUS_KM,
  googleMapsPlaceUrl,
  SEARCH_RADII_KM,
  type SearchQuery,
  type SearchResult,
  type Slot,
} from '@mandapambook/shared';
import { errorMessage } from '../../core/auth/auth.service';
import { BookingApi } from '../../core/booking-api.service';
import { HallCard } from '../../shared/hall-card';
import { SearchForm } from './search-form';

@Component({
  selector: 'app-search',
  imports: [FormsModule, RouterLink, HallCard, SearchForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-5 py-4">
      <app-search-form [initial]="formInitial()" />

      <div class="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          aria-label="Filters"
          class="flex h-fit flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm"
        >
          <h2 class="font-display text-xl">Filters</h2>
          <label class="flex items-center gap-2"
            ><input
              type="checkbox"
              class="size-4"
              [(ngModel)]="filters.ac"
              (ngModelChange)="apply()"
            />
            Air-conditioned</label
          >
          <label class="flex items-center gap-2"
            ><input
              type="checkbox"
              class="size-4"
              [(ngModel)]="filters.sadya"
              (ngModelChange)="apply()"
            />
            Sadya preparation area</label
          >
          <label class="flex flex-col gap-1"
            >Catering
            <select
              class="rounded-xl border border-slate-300 bg-white px-3 py-2"
              [(ngModel)]="filters.catering"
              (ngModelChange)="apply()"
            >
              <option value="">Any</option>
              <option value="OUTSIDE_ALLOWED">Outside caterers allowed</option>
              <option value="IN_HOUSE_ONLY">In-house only</option>
            </select>
          </label>
          <label class="flex flex-col gap-1"
            >Decoration
            <select
              class="rounded-xl border border-slate-300 bg-white px-3 py-2"
              [(ngModel)]="filters.decoration"
              (ngModelChange)="apply()"
            >
              <option value="">Any</option>
              <option value="OUTSIDE_ALLOWED">Outside decorators allowed</option>
              <option value="IN_HOUSE_ONLY">In-house only</option>
            </select>
          </label>
          <label class="flex flex-col gap-1"
            >Car parking at least
            <input
              type="number"
              min="0"
              class="rounded-xl border border-slate-300 bg-white px-3 py-2"
              [(ngModel)]="filters.minParking"
              (change)="apply()"
            />
          </label>
          <label class="flex flex-col gap-1"
            >Guest rooms at least
            <input
              type="number"
              min="0"
              class="rounded-xl border border-slate-300 bg-white px-3 py-2"
              [(ngModel)]="filters.minRooms"
              (change)="apply()"
            />
          </label>
          <label class="flex flex-col gap-1"
            >Rating at least
            <select
              class="rounded-xl border border-slate-300 bg-white px-3 py-2"
              [(ngModel)]="filters.minRating"
              (ngModelChange)="apply()"
            >
              <option [ngValue]="null">Any</option>
              <option [ngValue]="3">3+</option>
              <option [ngValue]="4">4+</option>
              <option [ngValue]="4.5">4.5+</option>
            </select>
          </label>
          <fieldset class="flex flex-col gap-1">
            <legend class="mb-1 font-medium">Amenities</legend>
            @for (a of allAmenities(); track a.code) {
              <label class="flex items-center gap-2"
                ><input
                  type="checkbox"
                  class="size-4"
                  [checked]="filters.amenities.includes(a.code)"
                  (change)="toggleAmenity(a.code)"
                />
                {{ a.name }}</label
              >
            }
          </fieldset>
        </aside>

        <div class="flex min-w-0 flex-col gap-3">
          @if (near(); as here) {
            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-forest-50 px-4 py-3 text-sm text-forest-900"
            >
              <span class="font-medium">Halls near your location</span>
              <label class="inline-flex items-center gap-1.5"
                >within
                <select
                  class="rounded-full border border-forest-200 bg-white px-3 py-1"
                  [ngModel]="radiusKm()"
                  (ngModelChange)="setRadius($event)"
                >
                  @for (r of radii; track r) {
                    <option [ngValue]="r">{{ r }} km</option>
                  }
                </select>
              </label>
              <a
                [href]="placeUrl(here)"
                target="_blank"
                rel="noopener"
                class="text-forest-800 underline"
                >See on Google Maps</a
              >
              <a
                routerLink="/search"
                [queryParams]="withoutLocation()"
                class="ml-auto font-medium text-forest-800 underline"
                >Clear location</a
              >
            </div>
          }
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-slate-600" aria-live="polite">
              {{ loading() ? 'Searching…' : total() + ' hall(s) found' }}
            </p>
            <label class="text-sm"
              >Sort
              <select
                class="ml-1 rounded-full border border-slate-300 bg-white px-3 py-1.5"
                [(ngModel)]="filters.sort"
                (ngModelChange)="apply()"
              >
                @if (near()) {
                  <option value="distance">Distance: nearest first</option>
                }
                <option value="recommended">Recommended</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="rating">Rating</option>
                <option value="capacity">Capacity</option>
              </select>
            </label>
          </div>
          @if (error()) {
            <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {{ error() }}
            </p>
          }
          <ul class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            @for (v of results(); track v.id) {
              <li>
                <app-hall-card [venue]="v" [queryParams]="venueParams()" />
              </li>
            } @empty {
              @if (!loading()) {
                <li
                  class="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600 sm:col-span-2 xl:col-span-3"
                >
                  @if (near()) {
                    No halls within {{ radiusKm() }} km match. Try a wider radius, another date or
                    fewer filters.
                  } @else {
                    No halls match. Try another date or fewer filters.
                  }
                </li>
              }
            }
          </ul>
          @if (total() > results().length + (page() - 1) * pageSize) {
            <button
              type="button"
              class="w-fit self-center rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-medium hover:border-slate-400"
              (click)="more()"
            >
              Show more
            </button>
          }
        </div>
      </div>
    </section>
  `,
})
export class Search {
  private readonly api = inject(BookingApi);
  private readonly router = inject(Router);

  // Bound from the URL by the router (withComponentInputBinding).
  readonly city = input<string>();
  readonly date = input<string>();
  readonly slot = input<Slot>();
  readonly guests = input<string>();
  readonly budget = input<string>();
  readonly lat = input<string>();
  readonly lng = input<string>();
  readonly radius = input<string>();

  protected readonly radii = SEARCH_RADII_KM;
  protected readonly placeUrl = googleMapsPlaceUrl;
  /** The searched point, when the URL has a valid lat/lng pair. */
  protected readonly near = computed<Coordinates | null>(() => {
    const latitude = Number(this.lat());
    const longitude = Number(this.lng());
    return this.lat() && this.lng() && Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;
  });
  protected readonly radiusKm = computed(() => {
    const r = Number(this.radius());
    return (SEARCH_RADII_KM as readonly number[]).includes(r) ? r : DEFAULT_SEARCH_RADIUS_KM;
  });

  protected readonly pageSize = 12;
  protected readonly results = signal<SearchResult[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly allAmenities = signal<{ code: string; name: string }[]>([]);
  protected filters = {
    ac: false,
    sadya: false,
    catering: '' as '' | 'OUTSIDE_ALLOWED' | 'IN_HOUSE_ONLY',
    decoration: '' as '' | 'OUTSIDE_ALLOWED' | 'IN_HOUSE_ONLY',
    minParking: null as number | null,
    minRooms: null as number | null,
    minRating: null as number | null,
    amenities: [] as string[],
    sort: 'recommended' as NonNullable<SearchQuery['sort']>,
  };

  protected readonly formInitial = computed(() => ({
    city: this.city() ?? '',
    date: this.date() ?? '',
    slot: (this.slot() ?? '') as Slot | '',
    guests: this.guests() ? Number(this.guests()) : null,
    budgetRupees: this.budget() ? Number(this.budget()) : null,
  }));
  /** Carries date/slot/guests to the venue page so the booking form is pre-filled. */
  protected readonly venueParams = computed(() => ({
    date: this.date() ?? null,
    slot: this.slot() ?? null,
    guests: this.guests() ?? null,
  }));

  constructor() {
    void this.api.amenities().then(
      (a) => this.allAmenities.set(a.items),
      () => undefined,
    );
    effect(() => {
      this.formInitial(); // re-run whenever the URL query changes
      const near = this.near();
      this.radiusKm();
      // A location search starts nearest first; distance makes no sense without one.
      if (near && this.lastNear === null) this.filters.sort = 'distance';
      if (!near && this.filters.sort === 'distance') this.filters.sort = 'recommended';
      this.lastNear = near;
      // Untracked: load() reads page() and other state, and "Show more" must not restart here.
      untracked(() => {
        this.page.set(1);
        void this.load(false);
      });
    });
  }

  private lastNear: Coordinates | null = null;

  /** The current URL query without the location, for "Clear location". */
  protected readonly withoutLocation = computed(() => ({
    date: this.date() ?? null,
    slot: this.slot() ?? null,
    guests: this.guests() ?? null,
    budget: this.budget() ?? null,
  }));

  protected setRadius(km: number): void {
    void this.router.navigate([], {
      queryParams: { radius: km },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private query(): SearchQuery {
    const f = this.filters;
    const budget = this.budget() ? Number(this.budget()) : undefined;
    const near = this.near();
    return {
      lat: near?.latitude,
      lng: near?.longitude,
      radiusKm: near ? this.radiusKm() : undefined,
      city: near ? undefined : this.city() || undefined,
      date: this.date() || undefined,
      slot: this.slot() || undefined,
      guests: this.guests() ? Number(this.guests()) : undefined,
      maxPricePaise: budget ? Math.round(budget) * 100 : undefined,
      ac: f.ac || undefined,
      sadya: f.sadya || undefined,
      catering: f.catering || undefined,
      decoration: f.decoration || undefined,
      minParking: f.minParking ?? undefined,
      minRooms: f.minRooms ?? undefined,
      minRating: f.minRating ?? undefined,
      amenities: f.amenities.length ? f.amenities : undefined,
      sort: f.sort,
      page: this.page(),
      pageSize: this.pageSize,
    } as SearchQuery;
  }

  private async load(append: boolean): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.search(this.query());
      this.results.set(append ? [...this.results(), ...res.items] : res.items);
      this.total.set(res.total);
    } catch (err) {
      this.error.set(errorMessage(err, 'Search failed. Try again.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected apply(): void {
    this.page.set(1);
    void this.load(false);
  }

  protected more(): void {
    this.page.update((p) => p + 1);
    void this.load(true);
  }

  protected toggleAmenity(code: string): void {
    const set = new Set(this.filters.amenities);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    this.filters.amenities = [...set];
    this.apply();
  }
}
