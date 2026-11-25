import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SearchResult } from '@mandapambook/shared';
import { InrPipe } from './inr.pipe';

/** A venue in a results grid: photo with a rating badge, then name, place, capacity and price. */
@Component({
  selector: 'app-hall-card',
  imports: [RouterLink, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = venue();
    <a
      [routerLink]="['/venues', v.slug]"
      [queryParams]="queryParams()"
      class="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 transition-shadow hover:shadow-[0_18px_40px_-24px_rgb(28_25_23/0.4)]"
    >
      <div class="relative overflow-hidden rounded-xl">
        @if (v.photoUrl) {
          <img
            [src]="v.photoUrl"
            [alt]="'Photo of ' + v.name"
            class="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        } @else {
          <div
            class="flex aspect-[4/3] items-center justify-center bg-slate-100 text-sm text-slate-500"
          >
            No photo yet
          </div>
        }
        @if (v.ratingAvg) {
          <span
            class="absolute top-2.5 left-2.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink"
            >★ {{ v.ratingAvg.toFixed(1) }} ({{ v.ratingCount }})</span
          >
        }
      </div>
      <div class="flex flex-1 flex-col gap-1 px-2 pt-3 pb-2">
        <h3 class="text-base font-semibold text-ink">{{ v.name }}</h3>
        <p class="text-sm text-slate-600">
          {{ v.locality ? v.locality + ', ' : '' }}{{ v.city }}
          @if (v.distanceKm !== null && v.distanceKm !== undefined) {
            <span class="font-medium text-forest-800"> · {{ distance(v.distanceKm) }} away</span>
          }
        </p>
        <p class="text-sm text-slate-600">
          Up to {{ v.maxCapacity }} guests · {{ v.parkingCars }} car parking
        </p>
        <ul class="flex flex-wrap gap-1.5 pt-1 text-xs font-medium" aria-label="Facilities">
          <li [class]="v.hasAc ? on : off">Hall {{ v.hasAc ? 'AC' : 'non-AC' }}</li>
          <li [class]="v.diningAc ? on : off">Dining {{ v.diningAc ? 'AC' : 'non-AC' }}</li>
          @if (v.sadyaPrepArea) {
            <li [class]="on">Sadya kitchen{{ v.cookingEquipment ? ' + equipment' : '' }}</li>
          }
        </ul>
        @if (v.fromPricePaise !== null) {
          <p class="mt-auto pt-2">
            <span class="text-xs text-slate-500">from </span
            ><span class="font-semibold text-ink tabular-nums">{{ v.fromPricePaise | inr }}</span>
          </p>
        }
      </div>
    </a>
  `,
})
export class HallCard {
  readonly venue = input.required<SearchResult>();
  readonly queryParams = input<Record<string, string | null>>({});

  protected readonly on =
    'rounded-full bg-forest-50 px-2 py-0.5 text-forest-800 ring-1 ring-forest-200';
  protected readonly off = 'rounded-full bg-slate-100 px-2 py-0.5 text-slate-600';

  protected distance(km: number): string {
    return km < 1 ? `${Math.max(100, Math.round(km * 10) * 100)} m` : `${km.toFixed(1)} km`;
  }
}
