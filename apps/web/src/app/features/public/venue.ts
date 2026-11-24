import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  googleMapsDirectionsUrl,
  googleMapsPlaceUrl,
  SLOTS,
  type Slot,
} from '@mandapambook/shared';
import {
  type Availability,
  BookingApi,
  SLOT_LABELS,
  type VenuePage,
} from '../../core/booking-api.service';
import { InsightsApi, type VenueReviews } from '../../core/insights-api.service';
import { InrPipe } from '../../shared/inr.pipe';

const POLICY_LABELS: Record<string, string> = {
  IN_HOUSE_ONLY: 'In-house only',
  OUTSIDE_ALLOWED: 'Outside allowed',
  NO_CATERING: 'No catering',
  NOT_ALLOWED: 'Not allowed',
};

@Component({
  selector: 'app-venue',
  imports: [RouterLink, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (venue(); as v) {
      <article class="flex flex-col gap-6 py-4">
        <header>
          <h1 class="font-display text-3xl font-medium text-balance">{{ v.name }}</h1>
          <p class="mt-1 text-slate-600">
            {{ v.addressLine }}{{ v.locality ? ', ' + v.locality : '' }}, {{ v.city }}
            {{ v.pincode }}
          </p>
          @if (maps(); as m) {
            <div class="mt-2 flex flex-wrap gap-2 text-sm">
              <a
                [href]="m.place"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 font-medium hover:border-slate-400"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  class="size-4 text-brand-600"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linejoin="round"
                >
                  <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
                  <circle cx="12" cy="9.5" r="2.5" />
                </svg>
                Open in Google Maps<span class="sr-only"> (opens in a new tab)</span>
              </a>
              <a
                [href]="m.directions"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1.5 rounded-full bg-forest-800 px-3.5 py-1.5 font-medium text-white hover:bg-forest-700"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  class="size-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linejoin="round"
                >
                  <path d="m3 11 18-8-8 18-2-8-8-2Z" />
                </svg>
                Get directions<span class="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          }
          <p class="mt-1 text-sm text-slate-600">
            Hosted by {{ v.hostedBy }}
            @if (v.ratingAvg) {
              · ★ {{ v.ratingAvg.toFixed(1) }} ({{ v.ratingCount }} reviews)
            }
            · {{ v.instantBook ? 'Instant confirmation' : 'Venue confirms each request' }}
          </p>
        </header>

        @if (v.photos.length) {
          <!-- A large lead photo with up to four beside it; any more scroll underneath. -->
          <div role="region" aria-label="Photos" class="flex flex-col gap-2">
            <div
              class="grid gap-2"
              [class.md:grid-cols-4]="v.photos.length > 1"
              [class.md:grid-rows-2]="v.photos.length > 2"
            >
              @for (p of v.photos.slice(0, 5); track p.url; let i = $index) {
                <img
                  [src]="p.url"
                  [alt]="p.altText || 'Photo of ' + v.name"
                  class="h-full w-full rounded-2xl object-cover"
                  [class]="
                    i === 0
                      ? 'aspect-[3/2] md:col-span-2 md:row-span-2 md:aspect-auto md:min-h-96'
                      : 'hidden aspect-[3/2] md:block' +
                        (v.photos.length === 2 ? ' md:col-span-2 md:aspect-auto' : '')
                  "
                  [attr.loading]="i === 0 ? null : 'lazy'"
                />
              }
            </div>
            <!-- Phones see the lead photo above and the rest here; wide screens only the 6th on. -->
            @for (row of overflowRows(v.photos.length); track row.from) {
              <div
                class="flex snap-x gap-2 overflow-x-auto"
                [class]="row.className"
                tabindex="0"
                aria-label="More photos"
              >
                @for (p of v.photos.slice(row.from); track p.url) {
                  <img
                    [src]="p.url"
                    [alt]="p.altText || 'Photo of ' + v.name"
                    class="aspect-[4/3] w-60 shrink-0 snap-start rounded-xl object-cover"
                    loading="lazy"
                  />
                }
              </div>
            }
          </div>
        }

        @if (v.description) {
          <p class="max-w-prose whitespace-pre-line">{{ v.description }}</p>
        }

        <section aria-labelledby="halls-h" class="flex flex-col gap-3">
          <h2 id="halls-h" class="font-display text-xl font-medium">Halls and prices</h2>
          @for (h of v.halls; track h.id) {
            <div class="rounded-2xl border border-slate-200 bg-white p-4">
              <p class="font-semibold">
                {{ h.name }}
                <span class="font-normal text-slate-600">· {{ h.seatingCapacity }} seated</span>
              </p>
              <ul
                class="mt-2 flex flex-wrap gap-2 text-xs font-medium"
                aria-label="Air-conditioning"
              >
                <li [class]="badge(h.isAc)">Hall: {{ h.isAc ? 'AC' : 'Non-AC' }}</li>
                @if (h.diningCapacity > 0) {
                  <li [class]="badge(h.diningIsAc)">
                    Dining ({{ h.diningCapacity }}): {{ h.diningIsAc ? 'AC' : 'Non-AC' }}
                  </li>
                } @else {
                  <li [class]="badge(false)">No dining area</li>
                }
              </ul>
              <ul class="mt-2 grid gap-2 sm:grid-cols-3">
                @for (s of slots; track s) {
                  @if (h.basePrices[s]; as price) {
                    <li
                      class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span
                        >{{ slotLabels[s] }}<br /><span class="font-semibold tabular-nums">{{
                          price | inr
                        }}</span></span
                      >
                      <a
                        [routerLink]="['/book', h.id]"
                        [queryParams]="{
                          date: date() || null,
                          slot: s,
                          guests: guests() || null,
                          slug: v.slug,
                        }"
                        class="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white"
                        >Book</a
                      >
                    </li>
                  }
                }
              </ul>
              <p class="mt-2 text-xs text-slate-500">
                Standard prices. Weekends, muhurtham days and seasons can differ; you'll see the
                exact price before paying.
              </p>
            </div>
          }
        </section>

        <section aria-labelledby="avail-h" class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="avail-h" class="font-display text-xl font-medium">Availability</h2>
            <div class="flex items-center gap-2">
              <button
                type="button"
                (click)="shift(-1)"
                class="rounded-full border border-slate-300 bg-white px-3 py-1 hover:border-slate-400"
                aria-label="Previous month"
              >
                ‹
              </button>
              <span class="min-w-32 text-center text-sm font-semibold" aria-live="polite">{{
                monthLabel()
              }}</span>
              <button
                type="button"
                (click)="shift(1)"
                class="rounded-full border border-slate-300 bg-white px-3 py-1 hover:border-slate-400"
                aria-label="Next month"
              >
                ›
              </button>
            </div>
          </div>
          @for (h of availability()?.halls ?? []; track h.hallId) {
            <div class="text-sm">
              <p class="font-medium">{{ h.name }}</p>
              @if (takenList(h.taken).length) {
                <ul class="mt-1 flex flex-wrap gap-1">
                  @for (t of takenList(h.taken); track t.date) {
                    <li class="rounded bg-slate-200 px-2 py-0.5 text-xs">
                      {{ t.label }}: {{ t.slots }}
                    </li>
                  }
                </ul>
              } @else {
                <p class="text-slate-600">Every date is open this month.</p>
              }
            </div>
          }
        </section>

        <section aria-labelledby="facts-h" class="grid gap-4 sm:grid-cols-2">
          <h2 id="facts-h" class="sr-only">Venue details</h2>
          <dl
            class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-2xl border border-slate-200 bg-white p-4 text-sm"
          >
            <dt class="text-slate-500">Catering</dt>
            <dd>{{ policy(v.cateringPolicy) }}</dd>
            <dt class="text-slate-500">Decoration</dt>
            <dd>{{ policy(v.decorationPolicy) }}</dd>
            <dt class="text-slate-500">Car parking</dt>
            <dd>{{ v.parkingCars }}</dd>
            <dt class="text-slate-500">Two-wheelers</dt>
            <dd>{{ v.parkingTwoWheelers }}</dd>
            <dt class="text-slate-500">Guest rooms</dt>
            <dd>{{ v.guestRooms }}</dd>
            <dt class="text-slate-500">Generator</dt>
            <dd>{{ v.hasGenerator ? 'Yes' : 'No' }}</dd>
            <dt class="text-slate-500">Sadya preparation area</dt>
            <dd>{{ v.sadyaPrepArea ? 'Yes, on site' : 'No' }}</dd>
            <dt class="text-slate-500">Cooking equipment</dt>
            <dd>{{ v.cookingEquipment ? 'Provided' : 'Not provided' }}</dd>
            <dt class="text-slate-500">Advance online</dt>
            <dd>{{ v.advancePercent }}% + platform fee</dd>
          </dl>
          <div class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <p class="font-semibold">Amenities</p>
            <p>
              @for (a of v.amenities; track a.code) {
                {{ a.name }}{{ $last ? '' : ' · ' }}
              } @empty {
                Not listed
              }
            </p>
            @if (v.cancellationPolicy) {
              <p class="font-semibold">Cancellation</p>
              <ul class="list-disc pl-5">
                @for (t of v.cancellationPolicy.tiers; track t.minDaysBefore) {
                  <li>
                    {{ t.minDaysBefore }}+ days before: {{ t.refundPercent }}% of the advance
                    refunded
                  </li>
                }
              </ul>
              <p class="text-xs text-slate-500">The platform fee is not refundable.</p>
            }
          </div>
        </section>

        @if (v.addons.length) {
          <section aria-labelledby="addons-h">
            <h2 id="addons-h" class="font-display text-xl font-medium">Add-ons</h2>
            <ul class="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              @for (a of v.addons; track a.id) {
                <li class="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                  {{ a.name }}: {{ a.pricePaise | inr
                  }}{{
                    a.unit === 'PER_ROOM' ? ' per room' : a.unit === 'PER_HOUR' ? ' per hour' : ''
                  }}
                </li>
              }
            </ul>
          </section>
        }

        <section aria-labelledby="reviews-h" class="flex flex-col gap-3">
          <h2 id="reviews-h" class="font-display text-xl font-medium">
            Reviews
            @if (reviews()?.ratingAvg; as avg) {
              <span class="text-base font-normal text-slate-600"
                >· ★ {{ avg.toFixed(1) }} from {{ reviews()?.ratingCount }}</span
              >
            }
          </h2>
          <ul class="flex flex-col gap-3">
            @for (r of reviews()?.items ?? []; track r.id) {
              <li class="rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200">
                <p class="flex flex-wrap justify-between gap-2">
                  <span class="font-semibold"
                    ><span class="text-amber-500" [attr.aria-label]="r.rating + ' out of 5'">{{
                      '★★★★★'.slice(0, r.rating)
                    }}</span>
                    {{ r.author }}</span
                  >
                  <span class="text-slate-500">Event in {{ r.eventMonth }}</span>
                </p>
                @if (r.body) {
                  <p class="mt-1 whitespace-pre-line">{{ r.body }}</p>
                }
                @if (r.ownerReply) {
                  <p class="mt-2 border-l-2 border-brand-500 pl-2 text-slate-700">
                    <span class="font-semibold">Reply from the venue:</span> {{ r.ownerReply }}
                  </p>
                }
              </li>
            } @empty {
              <li class="text-sm text-slate-600">No reviews yet.</li>
            }
          </ul>
          @if ((reviews()?.items?.length ?? 0) < (reviews()?.ratingCount ?? 0)) {
            <button
              type="button"
              class="w-fit rounded-full border border-slate-300 px-3 py-1.5 text-sm"
              (click)="moreReviews()"
            >
              More reviews
            </button>
          }
        </section>
      </article>
    } @else if (notFound()) {
      <section class="py-16 text-center">
        <h1 class="font-display text-3xl font-medium">Venue not found</h1>
        <a routerLink="/" class="mt-4 inline-block text-brand-700 underline">Search halls</a>
      </section>
    } @else {
      <p class="py-8">Loading…</p>
    }
  `,
})
export class Venue {
  private readonly api = inject(BookingApi);
  private readonly insights = inject(InsightsApi);
  protected readonly reviews = signal<VenueReviews | null>(null);
  readonly slug = input.required<string>();
  readonly date = input<string>();
  readonly slot = input<Slot>();
  readonly guests = input<string>();

  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly venue = signal<VenuePage | null>(null);
  protected readonly notFound = signal(false);
  protected readonly availability = signal<Availability | null>(null);
  protected readonly month = signal(this.initialMonth());

  protected readonly monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number) as [number, number];
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  });
  /**
   * Google Maps links (plain links, no embedded map: no API key, tracking or extra CSP). The
   * pin when the owner set one, otherwise a search for the full address.
   */
  protected readonly maps = computed(() => {
    const v = this.venue();
    if (!v) return null;
    const target =
      v.latitude !== null && v.longitude !== null
        ? { latitude: v.latitude, longitude: v.longitude }
        : [v.name, v.addressLine, v.locality, `${v.city} ${v.pincode}`, v.state]
            .filter(Boolean)
            .join(', ');
    return { place: googleMapsPlaceUrl(target), directions: googleMapsDirectionsUrl(target) };
  });

  constructor() {
    effect(() => {
      void this.load(this.slug());
    });
    effect(() => {
      const v = this.venue();
      const m = this.month();
      if (v)
        void this.api.availability(v.id, m).then(
          (a) => this.availability.set(a),
          () => undefined,
        );
    });
  }

  private initialMonth(): string {
    const d =
      this.date?.() ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    return d.slice(0, 7);
  }

  private async load(slug: string): Promise<void> {
    try {
      const v = await this.api.venue(slug);
      this.venue.set(v);
      void this.insights.venueReviews(v.id).then(
        (r) => this.reviews.set(r),
        () => undefined,
      );
      const date = this.date();
      if (date) this.month.set(date.slice(0, 7));
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) this.notFound.set(true);
    }
  }

  protected async moreReviews(): Promise<void> {
    const v = this.venue();
    const current = this.reviews();
    if (!v || !current) return;
    const next = await this.insights.venueReviews(v.id, current.items.length);
    this.reviews.set({ ...next, items: [...current.items, ...next.items] });
  }

  protected shift(by: number): void {
    const [y, m] = this.month().split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    this.month.set(d.toISOString().slice(0, 7));
  }

  /** Photo rows under the gallery: phones scroll photos 2+, wide screens photos 6+. */
  protected overflowRows(n: number): { from: number; className: string }[] {
    const rows: { from: number; className: string }[] = [];
    if (n > 1) rows.push({ from: 1, className: 'md:hidden' });
    if (n > 5) rows.push({ from: 5, className: 'hidden md:flex' });
    return rows;
  }

  protected policy(code: string): string {
    return POLICY_LABELS[code] ?? code;
  }

  /** A small label: green-tinted when the feature is there, neutral when it isn't. */
  protected badge(on: boolean): string {
    return on
      ? 'rounded-full bg-forest-50 px-2.5 py-1 text-forest-800 ring-1 ring-forest-200'
      : 'rounded-full bg-slate-100 px-2.5 py-1 text-slate-600';
  }

  protected takenList(
    taken: Record<string, Slot[]>,
  ): { date: string; label: string; slots: string }[] {
    return Object.entries(taken)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, slots]) => ({
        date,
        label: new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
        }),
        slots: slots.includes('FULL_DAY')
          ? 'full day booked'
          : slots.map((s) => SLOT_LABELS[s].split(' ')[0]).join(', ') + ' booked',
      }));
  }
}
