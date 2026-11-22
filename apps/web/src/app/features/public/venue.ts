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
import { SLOTS, type Slot } from '@mandapambook/shared';
import {
  type Availability,
  BookingApi,
  SLOT_LABELS,
  type VenuePage,
} from '../../core/booking-api.service';
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
          <h1 class="font-display text-3xl font-bold text-balance">{{ v.name }}</h1>
          <p class="mt-1 text-slate-600">
            {{ v.addressLine }}{{ v.locality ? ', ' + v.locality : '' }}, {{ v.city }}
            {{ v.pincode }}
            @if (mapUrl()) {
              ·
              <a [href]="mapUrl()" target="_blank" rel="noopener" class="text-brand-700 underline"
                >View on map</a
              >
            }
          </p>
          <p class="mt-1 text-sm text-slate-600">
            Hosted by {{ v.hostedBy }}
            @if (v.ratingAvg) {
              · ★ {{ v.ratingAvg.toFixed(1) }} ({{ v.ratingCount }} reviews)
            }
            · {{ v.instantBook ? 'Instant confirmation' : 'Venue confirms each request' }}
          </p>
        </header>

        @if (v.photos.length) {
          <div
            class="flex snap-x gap-2 overflow-x-auto"
            role="region"
            aria-label="Photos"
            tabindex="0"
          >
            @for (p of v.photos; track p.url) {
              <img
                [src]="p.url"
                [alt]="p.altText || 'Photo of ' + v.name"
                class="aspect-[4/3] w-72 shrink-0 snap-start rounded-lg object-cover sm:w-96"
                loading="lazy"
              />
            }
          </div>
        }

        @if (v.description) {
          <p class="max-w-prose whitespace-pre-line">{{ v.description }}</p>
        }

        <section aria-labelledby="halls-h" class="flex flex-col gap-3">
          <h2 id="halls-h" class="font-display text-xl font-semibold">Halls and prices</h2>
          @for (h of v.halls; track h.id) {
            <div class="rounded-lg border border-slate-200 bg-white p-4">
              <p class="font-semibold">
                {{ h.name }}
                <span class="font-normal text-slate-600"
                  >· {{ h.seatingCapacity }} seated · {{ h.diningCapacity }} dining ·
                  {{ h.isAc ? 'AC' : 'Non-AC' }}</span
                >
              </p>
              <ul class="mt-2 grid gap-2 sm:grid-cols-3">
                @for (s of slots; track s) {
                  @if (h.basePrices[s]; as price) {
                    <li
                      class="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
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
                        class="rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white"
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
            <h2 id="avail-h" class="font-display text-xl font-semibold">Availability</h2>
            <div class="flex items-center gap-2">
              <button
                type="button"
                (click)="shift(-1)"
                class="rounded border px-2 py-1"
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
                class="rounded border px-2 py-1"
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
            class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm"
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
            <dt class="text-slate-500">Advance online</dt>
            <dd>{{ v.advancePercent }}% + platform fee</dd>
          </dl>
          <div class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
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
            <h2 id="addons-h" class="font-display text-xl font-semibold">Add-ons</h2>
            <ul class="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              @for (a of v.addons; track a.id) {
                <li class="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200">
                  {{ a.name }}: {{ a.pricePaise | inr
                  }}{{
                    a.unit === 'PER_ROOM' ? ' per room' : a.unit === 'PER_HOUR' ? ' per hour' : ''
                  }}
                </li>
              }
            </ul>
          </section>
        }
      </article>
    } @else if (notFound()) {
      <section class="py-16 text-center">
        <h1 class="font-display text-2xl font-bold">Venue not found</h1>
        <a routerLink="/" class="mt-4 inline-block text-brand-700 underline">Search halls</a>
      </section>
    } @else {
      <p class="py-8">Loading…</p>
    }
  `,
})
export class Venue {
  private readonly api = inject(BookingApi);
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
  /** OpenStreetMap link (no embedded third-party map, so no tracking and no extra CSP). */
  protected readonly mapUrl = computed(() => {
    const v = this.venue();
    return v?.latitude && v.longitude
      ? `https://www.openstreetmap.org/?mlat=${v.latitude}&mlon=${v.longitude}#map=17/${v.latitude}/${v.longitude}`
      : null;
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
      this.venue.set(await this.api.venue(slug));
      const date = this.date();
      if (date) this.month.set(date.slice(0, 7));
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) this.notFound.set(true);
    }
  }

  protected shift(by: number): void {
    const [y, m] = this.month().split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    this.month.set(d.toISOString().slice(0, 7));
  }

  protected policy(code: string): string {
    return POLICY_LABELS[code] ?? code;
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
