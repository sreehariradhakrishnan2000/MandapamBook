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
    <form
      (ngSubmit)="go()"
      class="grid gap-3 rounded-2xl border border-gold-500/50 bg-white p-5 shadow-xl shadow-brand-900/10 sm:grid-cols-6"
      role="search"
      aria-label="Find a hall"
    >
      <label class="flex flex-col gap-1 text-sm font-medium text-slate-700 sm:col-span-2"
        >City
        <select
          name="city"
          class="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-normal text-ink focus:border-brand-500"
          [(ngModel)]="value.city"
        >
          <option value="">Anywhere</option>
          @for (c of cities(); track c.slug) {
            <option [value]="c.slug">{{ c.name }}, {{ c.state }}</option>
          }
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium text-slate-700"
        >Date
        <input
          name="date"
          type="date"
          [min]="today"
          class="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-normal text-ink focus:border-brand-500"
          [(ngModel)]="value.date"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium text-slate-700"
        >Slot
        <select
          name="slot"
          class="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-normal text-ink focus:border-brand-500"
          [(ngModel)]="value.slot"
        >
          <option value="">Any</option>
          @for (s of slots; track s) {
            <option [value]="s">{{ slotLabels[s] }}</option>
          }
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium text-slate-700"
        >Guests
        <input
          name="guests"
          type="number"
          min="1"
          inputmode="numeric"
          placeholder="e.g. 500"
          class="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-normal text-ink focus:border-brand-500"
          [(ngModel)]="value.guests"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium text-slate-700"
        >Budget (₹, max)
        <input
          name="budget"
          type="number"
          min="0"
          inputmode="numeric"
          placeholder="e.g. 150000"
          class="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-normal text-ink focus:border-brand-500"
          [(ngModel)]="value.budgetRupees"
        />
      </label>
      <button
        type="submit"
        class="rounded-full bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-md hover:bg-brand-700 sm:col-span-6 sm:justify-self-end"
      >
        Search halls
      </button>
    </form>
  `,
})
export class SearchForm implements OnInit {
  private readonly api = inject(BookingApi);
  private readonly router = inject(Router);
  readonly initial = input<Partial<SearchFormValue>>({});

  protected readonly cities = signal<{ slug: string; name: string; state: string }[]>([]);
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
