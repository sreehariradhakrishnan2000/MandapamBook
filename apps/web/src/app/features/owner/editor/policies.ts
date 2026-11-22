import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../../core/auth/auth.service';
import {
  type Amenity,
  type CancellationTier,
  OwnerApi,
  type VenueDetail,
} from '../../../core/owner-api.service';
import { InrPipe, rupeesToPaiseInput } from '../../../shared/inr.pipe';

const DEFAULT_TIERS: CancellationTier[] = [
  { minDaysBefore: 60, refundPercent: 90 },
  { minDaysBefore: 30, refundPercent: 50 },
  { minDaysBefore: 0, refundPercent: 0 },
];

@Component({
  selector: 'app-venue-policies',
  imports: [FormsModule, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-8">
      @if (error()) {
        <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
      @if (message()) {
        <p class="rounded-md bg-leaf-600/10 px-3 py-2 text-sm text-leaf-600" role="status">
          {{ message() }}
        </p>
      }

      <fieldset class="flex flex-col gap-3">
        <legend class="font-semibold">Amenities</legend>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          @for (a of allAmenities(); track a.code) {
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="size-4"
                [checked]="selected().has(a.code)"
                (change)="toggle(a.code)"
              />
              {{ a.name }}
            </label>
          }
        </div>
        <button
          type="button"
          (click)="saveAmenities()"
          class="w-fit rounded-md border border-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-700"
        >
          Save amenities
        </button>
      </fieldset>

      <fieldset class="flex flex-col gap-3">
        <legend class="font-semibold">Cancellation refunds</legend>
        <p class="text-sm text-slate-600">
          Refund of the advance by how many days before the event the customer cancels.
        </p>
        @for (t of tiers(); track $index) {
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <label [for]="'days-' + $index">At least</label>
            <input
              [id]="'days-' + $index"
              type="number"
              min="0"
              max="365"
              class="w-20 rounded-md border border-slate-300 px-2 py-1"
              [(ngModel)]="t.minDaysBefore"
            />
            <span>days before:</span>
            <label class="sr-only" [for]="'pct-' + $index">Refund percent</label>
            <input
              [id]="'pct-' + $index"
              type="number"
              min="0"
              max="100"
              class="w-20 rounded-md border border-slate-300 px-2 py-1"
              [(ngModel)]="t.refundPercent"
            />
            <span>% refund</span>
          </div>
        }
        <button
          type="button"
          (click)="savePolicy()"
          class="w-fit rounded-md border border-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-700"
        >
          Save policy
        </button>
      </fieldset>

      <fieldset class="flex flex-col gap-3">
        <legend class="font-semibold">Add-ons</legend>
        <ul class="divide-y divide-slate-100 text-sm">
          @for (a of venue().addons; track a.id) {
            <li class="flex items-center justify-between py-2">
              <span
                >{{ a.name }} · {{ a.pricePaise | inr }}
                {{
                  a.unit === 'PER_ROOM' ? 'per room' : a.unit === 'PER_HOUR' ? 'per hour' : ''
                }}</span
              >
              <button type="button" (click)="removeAddon(a.id)" class="text-red-700 underline">
                Remove
              </button>
            </li>
          } @empty {
            <li class="py-2 text-slate-500">No add-ons yet.</li>
          }
        </ul>
        <div class="flex flex-wrap items-end gap-2 text-sm">
          <label class="flex flex-col gap-1"
            >Name<input
              class="rounded-md border border-slate-300 px-2 py-1.5"
              [(ngModel)]="addonName"
          /></label>
          <label class="flex flex-col gap-1"
            >Price (₹)<input
              type="number"
              min="0"
              class="w-28 rounded-md border border-slate-300 px-2 py-1.5"
              [(ngModel)]="addonRupees"
          /></label>
          <label class="flex flex-col gap-1"
            >Charged
            <select class="rounded-md border border-slate-300 px-2 py-1.5" [(ngModel)]="addonUnit">
              <option value="PER_EVENT">per event</option>
              <option value="PER_ROOM">per room</option>
              <option value="PER_HOUR">per hour</option>
            </select>
          </label>
          <button
            type="button"
            (click)="addAddon()"
            class="rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white"
          >
            Add
          </button>
        </div>
      </fieldset>
    </div>
  `,
})
export class VenuePolicies implements OnInit {
  private readonly api = inject(OwnerApi);
  readonly venue = input.required<VenueDetail>();
  readonly changed = output();

  protected readonly allAmenities = signal<Amenity[]>([]);
  protected readonly selected = signal(new Set<string>());
  protected readonly tiers = signal<CancellationTier[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected addonName = '';
  protected addonRupees = 0;
  protected addonUnit: 'PER_EVENT' | 'PER_ROOM' | 'PER_HOUR' = 'PER_EVENT';

  async ngOnInit(): Promise<void> {
    const v = this.venue();
    this.selected.set(new Set(v.amenities.map((a) => a.code)));
    this.tiers.set((v.cancellationPolicy?.tiers ?? DEFAULT_TIERS).map((t) => ({ ...t })));
    this.allAmenities.set((await this.api.amenities()).items);
  }

  protected toggle(code: string): void {
    const next = new Set(this.selected());
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.selected.set(next);
  }

  private async run(action: () => Promise<unknown>, done: string): Promise<void> {
    this.error.set(null);
    this.message.set(null);
    try {
      await action();
      this.message.set(done);
      this.changed.emit();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected saveAmenities = () =>
    this.run(
      () => this.api.setAmenities(this.venue().id, [...this.selected()]),
      'Amenities saved.',
    );
  protected savePolicy = () =>
    this.run(
      () => this.api.setPolicy(this.venue().id, this.tiers(), ''),
      'Cancellation policy saved.',
    );
  protected removeAddon = (id: string) =>
    this.run(() => this.api.removeAddon(id), 'Add-on removed.');

  protected addAddon(): Promise<void> {
    const name = this.addonName.trim();
    const code = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);
    if (name.length < 2 || code.length < 2) {
      this.error.set('Give the add-on a name.');
      return Promise.resolve();
    }
    return this.run(
      () =>
        this.api.addAddon(this.venue().id, {
          code,
          name,
          unit: this.addonUnit,
          pricePaise: rupeesToPaiseInput(this.addonRupees),
          maxQuantity: this.addonUnit === 'PER_ROOM' ? 50 : 1,
        }),
      'Add-on added.',
    ).then(() => {
      this.addonName = '';
      this.addonRupees = 0;
    });
  }
}
