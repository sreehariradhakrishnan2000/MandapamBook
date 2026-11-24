import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SLOTS, type Slot } from '@mandapambook/shared';
import { BookingApi, SLOT_LABELS } from '../../core/booking-api.service';

export interface SearchFormValue {
  city: string;
  date: string;
  slot: Slot | '';
  guests: number | null;
  budgetRupees: number | null;
}

/** City, date, slot, guests and budget: the search everyone starts with. */
@Component({
  selector: 'app-search-form',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      A white pill: fields side by side with thin dividers and a round search button on wide
      screens; a stacked card with a full-width button on phones.
    -->
    <form
      (ngSubmit)="go()"
      class="grid grid-cols-2 gap-1 rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_18px_40px_-24px_rgb(28_25_23/0.35)] lg:flex lg:items-center lg:rounded-full lg:p-1.5"
      role="search"
      aria-label="Find a hall"
    >
      <label [class]="field + ' col-span-2 lg:min-w-48 lg:flex-[1.4]'"
        ><span [class]="caption">City</span>
        <select name="city" [class]="control" [(ngModel)]="value.city">
          <option value="">Anywhere</option>
          @for (c of cities(); track c.slug) {
            <option [value]="c.slug">{{ c.name }}, {{ c.state }}</option>
          }
        </select>
      </label>
      <label [class]="field + divider"
        ><span [class]="caption">Date</span>
        <input name="date" type="date" [min]="today" [class]="control" [(ngModel)]="value.date" />
      </label>
      <label [class]="field + divider"
        ><span [class]="caption">Slot</span>
        <select name="slot" [class]="control" [(ngModel)]="value.slot">
          <option value="">Any</option>
          @for (s of slots; track s) {
            <option [value]="s">{{ slotLabels[s] }}</option>
          }
        </select>
      </label>
      <label [class]="field + divider"
        ><span [class]="caption">Guests</span>
        <input
          name="guests"
          type="number"
          min="1"
          inputmode="numeric"
          placeholder="e.g. 500"
          [class]="control"
          [(ngModel)]="value.guests"
        />
      </label>
      <label [class]="field + divider"
        ><span [class]="caption">Budget (₹, max)</span>
        <input
          name="budget"
          type="number"
          min="0"
          inputmode="numeric"
          placeholder="e.g. 150000"
          [class]="control"
          [(ngModel)]="value.budgetRupees"
        />
      </label>
      <button
        type="submit"
        class="col-span-2 mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700 lg:mt-0 lg:size-13 lg:shrink-0 lg:p-0"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          class="size-5"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
        <span class="lg:sr-only">Search halls</span>
      </button>
    </form>
  `,
})
export class SearchForm implements OnInit {
  private readonly api = inject(BookingApi);
  private readonly router = inject(Router);
  readonly initial = input<Partial<SearchFormValue>>({});

  protected readonly cities = signal<{ slug: string; name: string; state: string }[]>([]);
  protected readonly field =
    'flex min-w-0 flex-col gap-0.5 rounded-2xl px-4 py-2.5 hover:bg-slate-50 focus-within:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500 lg:flex-1 lg:rounded-full lg:px-5';
  protected readonly divider =
    ' lg:relative lg:before:absolute lg:before:inset-y-3 lg:before:left-0 lg:before:w-px lg:before:bg-slate-200';
  protected readonly caption = 'text-xs font-medium text-slate-500';
  protected readonly control =
    'w-full min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-ink outline-none focus:ring-0';
  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(),
  );
  protected value: SearchFormValue = {
    city: '',
    date: '',
    slot: '',
    guests: null,
    budgetRupees: null,
  };

  async ngOnInit(): Promise<void> {
    this.value = { ...this.value, ...this.initial() };
    try {
      this.cities.set((await this.api.cities()).items);
    } catch {
      // The form still works without the list (search "Anywhere").
    }
  }

  protected go(): void {
    const v = this.value;
    void this.router.navigate(['/search'], {
      queryParams: {
        city: v.city || null,
        date: v.date || null,
        slot: v.slot || null,
        guests: v.guests || null,
        budget: v.budgetRupees || null,
      },
    });
  }
}
