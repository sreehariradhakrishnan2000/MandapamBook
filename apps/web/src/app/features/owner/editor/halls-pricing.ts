import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SLOTS, type Slot } from '@mandapambook/shared';
import { errorMessage } from '../../../core/auth/auth.service';
import { type Hall, OwnerApi, type PricingRule } from '../../../core/owner-api.service';
import { FormField, INPUT_CLASS } from '../../../shared/form-field';
import { InrPipe, rupeesToPaiseInput } from '../../../shared/inr.pipe';

export const SLOT_LABELS: Record<Slot, string> = {
  MORNING: 'Muhurtham (morning)',
  EVENING: 'Reception (evening)',
  FULL_DAY: 'Full day',
};

type Kind = 'BASE' | 'WEEKEND' | 'MUHURTHAM';
const KIND_LABELS: Record<Kind, string> = {
  BASE: 'Standard',
  WEEKEND: 'Weekend',
  MUHURTHAM: 'Muhurtham day',
};

@Component({
  selector: 'app-halls-pricing',
  imports: [ReactiveFormsModule, FormField, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }

      @for (hall of halls(); track hall.id) {
        <section
          class="rounded-2xl border border-slate-200 bg-white p-4"
          [attr.aria-labelledby]="'hall-' + hall.id"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 [id]="'hall-' + hall.id" class="font-semibold">{{ hall.name }}</h3>
            <p class="text-sm text-slate-600">
              {{ hall.seatingCapacity }} seated · {{ hall.diningCapacity }} dining ·
              {{ hall.isAc ? 'AC' : 'Non-AC' }}
            </p>
          </div>
          <div class="mt-3 overflow-x-auto">
            <table class="w-full min-w-[28rem] text-sm">
              <caption class="sr-only">
                Prices for
                {{
                  hall.name
                }}
              </caption>
              <thead>
                <tr class="text-left text-slate-500">
                  <th class="py-1 font-medium">Slot</th>
                  @for (k of kinds; track k) {
                    <th class="py-1 font-medium">{{ kindLabels[k] }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (slot of slots; track slot) {
                  <tr class="border-t border-slate-100">
                    <th scope="row" class="py-2 text-left font-normal">{{ slotLabels[slot] }}</th>
                    @for (k of kinds; track k) {
                      <td class="py-2 tabular-nums">
                        {{ (price(hall.id, slot, k) | inr) || '—' }}
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <form
            [formGroup]="priceForm"
            (ngSubmit)="setPrice(hall.id)"
            class="mt-3 flex flex-wrap items-end gap-2"
          >
            <label class="sr-only" [for]="'slot-' + hall.id">Slot</label>
            <select
              [id]="'slot-' + hall.id"
              formControlName="slot"
              class="rounded-xl border border-slate-300 px-2 py-2 text-sm"
            >
              @for (s of slots; track s) {
                <option [value]="s">{{ slotLabels[s] }}</option>
              }
            </select>
            <label class="sr-only" [for]="'kind-' + hall.id">Price type</label>
            <select
              [id]="'kind-' + hall.id"
              formControlName="kind"
              class="rounded-xl border border-slate-300 px-2 py-2 text-sm"
            >
              @for (k of kinds; track k) {
                <option [value]="k">{{ kindLabels[k] }}</option>
              }
            </select>
            <label class="sr-only" [for]="'rupees-' + hall.id">Price in rupees</label>
            <input
              [id]="'rupees-' + hall.id"
              type="number"
              min="1"
              step="1"
              formControlName="rupees"
              placeholder="₹ amount"
              class="w-36 rounded-xl border border-slate-300 px-2 py-2 text-sm"
            />
            <button
              type="submit"
              class="rounded-full bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
            >
              Set price
            </button>
          </form>
        </section>
      } @empty {
        <p class="text-slate-600">
          Add the halls you rent out. Each hall gets its own prices and calendar.
        </p>
      }

      <form
        [formGroup]="hallForm"
        (ngSubmit)="addHall()"
        class="grid gap-3 rounded-2xl border border-dashed border-slate-300 p-4 sm:grid-cols-4"
        novalidate
      >
        <h3 class="font-semibold sm:col-span-4">Add a hall</h3>
        <app-form-field for="hallName" label="Name"
          ><input id="hallName" formControlName="name" [class]="inputClass"
        /></app-form-field>
        <app-form-field for="seating" label="Seating"
          ><input
            id="seating"
            type="number"
            min="1"
            formControlName="seatingCapacity"
            [class]="inputClass"
        /></app-form-field>
        <app-form-field for="dining" label="Dining"
          ><input
            id="dining"
            type="number"
            min="0"
            formControlName="diningCapacity"
            [class]="inputClass"
        /></app-form-field>
        <label class="flex items-center gap-2 self-end pb-3 text-sm"
          ><input type="checkbox" formControlName="isAc" class="size-4" /> Air-conditioned</label
        >
        <button
          type="submit"
          class="rounded-full border border-brand-600 px-3 py-2 font-semibold text-brand-700 sm:col-span-4 sm:justify-self-start"
        >
          Add hall
        </button>
      </form>
    </div>
  `,
})
export class HallsPricing {
  private readonly api = inject(OwnerApi);
  readonly venueId = input.required<string>();
  readonly halls = input.required<Hall[]>();
  readonly changed = output();

  protected readonly inputClass = INPUT_CLASS;
  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly kinds: Kind[] = ['BASE', 'WEEKEND', 'MUHURTHAM'];
  protected readonly kindLabels = KIND_LABELS;
  protected readonly rules = signal<Record<string, PricingRule[]>>({});
  protected readonly error = signal<string | null>(null);

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly hallForm = this.fb.group({
    name: ['', Validators.required],
    seatingCapacity: [300, [Validators.required, Validators.min(1)]],
    diningCapacity: [150, Validators.min(0)],
    isAc: [true],
  });
  protected readonly priceForm = this.fb.group({
    slot: ['MORNING' as Slot],
    kind: ['BASE' as Kind],
    rupees: [0, [Validators.required, Validators.min(1)]],
  });

  constructor() {
    effect(() => {
      void this.loadRules(this.halls());
    });
  }

  private async loadRules(halls: Hall[]): Promise<void> {
    const entries = await Promise.all(
      halls.map(async (h) => [h.id, (await this.api.pricingRules(h.id)).items] as const),
    );
    this.rules.set(Object.fromEntries(entries));
  }

  protected price(hallId: string, slot: Slot, kind: Kind): number | null {
    return (
      this.rules()[hallId]?.find((r) => r.slot === slot && r.kind === kind)?.pricePaise ?? null
    );
  }

  protected async setPrice(hallId: string): Promise<void> {
    if (this.priceForm.invalid) {
      this.error.set('Enter a price of at least ₹1.');
      return;
    }
    const { slot, kind, rupees } = this.priceForm.getRawValue();
    try {
      await this.api.addPricingRule(hallId, { slot, kind, pricePaise: rupeesToPaiseInput(rupees) });
      this.error.set(null);
      await this.loadRules(this.halls());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async addHall(): Promise<void> {
    if (this.hallForm.invalid) return;
    try {
      await this.api.addHall(this.venueId(), this.hallForm.getRawValue());
      this.hallForm.reset();
      this.changed.emit();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
