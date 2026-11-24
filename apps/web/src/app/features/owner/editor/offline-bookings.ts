import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SLOTS, type Slot, normalizeIndianMobile } from '@mandapambook/shared';
import { errorMessage } from '../../../core/auth/auth.service';
import { type Hall, type OfflineBooking, OwnerApi } from '../../../core/owner-api.service';
import { InrPipe, rupeesToPaiseInput } from '../../../shared/inr.pipe';
import { SLOT_LABELS } from './halls-pricing';

const EVENT_TYPES = ['Wedding', 'Engagement', 'Reception', 'Birthday', 'Meeting', 'Other'];

interface Draft {
  hallId: string;
  slots: { eventDate: string; slot: Slot }[];
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  eventType: string;
  amountRupees: number | null;
  advanceRupees: number | null;
  notes: string;
}

/**
 * Bookings the venue took outside MandapamBook (by phone or in person). Recording one holds
 * its dates exactly like an online booking, so nobody can book them on the app.
 */
@Component({
  selector: 'app-offline-bookings',
  imports: [FormsModule, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="offline-h" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="offline-h" class="font-display text-lg font-medium">
            Bookings taken outside MandapamBook
          </h3>
          <p class="text-sm text-slate-600">
            Booked by phone or in person? Record it here so the date can't be booked online.
          </p>
        </div>
        @if (!formOpen()) {
          <button
            type="button"
            class="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            (click)="open()"
          >
            Record an offline booking
          </button>
        }
      </div>

      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }

      @if (formOpen()) {
        <form
          class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2"
          (ngSubmit)="save()"
          aria-label="Record an offline booking"
        >
          <label class="flex flex-col gap-1"
            >Hall
            <select
              name="hall"
              [class]="input"
              [(ngModel)]="draft.hallId"
              [disabled]="!!editing()"
              required
            >
              @for (h of halls(); track h.id) {
                <option [value]="h.id">{{ h.name }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col gap-1"
            >Event (optional)
            <input
              name="eventType"
              list="event-types"
              maxlength="80"
              [class]="input"
              [(ngModel)]="draft.eventType"
            />
            <datalist id="event-types">
              @for (t of eventTypes; track t) {
                <option [value]="t"></option>
              }
            </datalist>
          </label>

          <fieldset class="flex flex-col gap-2 sm:col-span-2" [disabled]="!!editing()">
            <legend class="mb-1 font-medium">Dates</legend>
            @if (editing()) {
              <p class="text-xs text-slate-500">
                To change the dates, cancel this booking and record it again.
              </p>
            }
            @for (s of draft.slots; track $index; let i = $index) {
              <div class="flex flex-wrap items-end gap-2">
                <label class="flex flex-col gap-1"
                  ><span class="sr-only">Date {{ i + 1 }}</span>
                  <input
                    type="date"
                    [name]="'date' + i"
                    [min]="today"
                    required
                    [class]="input"
                    [(ngModel)]="s.eventDate"
                  />
                </label>
                <label class="flex flex-col gap-1"
                  ><span class="sr-only">Slot {{ i + 1 }}</span>
                  <select [name]="'slot' + i" [class]="input" [(ngModel)]="s.slot">
                    @for (x of slotList; track x) {
                      <option [value]="x">{{ slotLabels[x] }}</option>
                    }
                  </select>
                </label>
                @if (draft.slots.length > 1) {
                  <button
                    type="button"
                    class="pb-2 text-slate-600 underline"
                    (click)="draft.slots.splice(i, 1)"
                  >
                    Remove
                  </button>
                }
              </div>
            }
            <button type="button" class="w-fit text-brand-700 underline" (click)="addDate()">
              + Add another date
            </button>
          </fieldset>

          <label class="flex flex-col gap-1"
            >Guest name
            <input
              name="customerName"
              required
              minlength="2"
              maxlength="120"
              autocomplete="off"
              [class]="input"
              [(ngModel)]="draft.customerName"
            />
          </label>
          <label class="flex flex-col gap-1"
            >Guest mobile number
            <input
              name="customerPhone"
              required
              inputmode="tel"
              autocomplete="off"
              placeholder="98470 12345"
              [class]="input"
              [(ngModel)]="draft.customerPhone"
            />
          </label>
          <label class="flex flex-col gap-1 sm:col-span-2"
            >Guest email (optional)
            <input
              name="customerEmail"
              type="email"
              autocomplete="off"
              maxlength="254"
              [class]="input"
              [(ngModel)]="draft.customerEmail"
            />
          </label>
          <label class="flex flex-col gap-1"
            >Amount agreed (₹, optional)
            <input
              name="amount"
              type="number"
              min="0"
              inputmode="numeric"
              [class]="input"
              [(ngModel)]="draft.amountRupees"
            />
          </label>
          <label class="flex flex-col gap-1"
            >Advance received (₹, optional)
            <input
              name="advance"
              type="number"
              min="0"
              inputmode="numeric"
              [class]="input"
              [(ngModel)]="draft.advanceRupees"
            />
          </label>
          <label class="flex flex-col gap-1 sm:col-span-2"
            >Notes (optional)
            <textarea
              name="notes"
              rows="2"
              maxlength="1000"
              [class]="input"
              [(ngModel)]="draft.notes"
            ></textarea>
          </label>
          <p class="text-xs text-slate-500 sm:col-span-2">
            The guest's details are only visible to you and your staff. Their email or mobile number
            lets them review your venue after the event from their MandapamBook account.
          </p>
          <div class="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              [disabled]="busy()"
              class="rounded-full bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {{ editing() ? 'Save changes' : 'Save booking' }}
            </button>
            <button
              type="button"
              class="rounded-full border border-slate-300 bg-white px-4 py-2"
              (click)="close()"
            >
              Cancel
            </button>
          </div>
        </form>
      }

      <label class="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          class="size-4"
          [ngModel]="showCancelled()"
          (ngModelChange)="showCancelled.set($event)"
        />
        Show cancelled
      </label>

      <ul class="flex flex-col gap-2">
        @for (b of visible(); track b.id) {
          <li
            class="rounded-2xl border border-slate-200 bg-white p-4 text-sm"
            [class.opacity-60]="b.status === 'CANCELLED'"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="font-semibold">
                  {{ b.customerName }}
                  @if (b.eventType) {
                    <span class="font-normal text-slate-600"> · {{ b.eventType }}</span>
                  }
                  @if (b.status === 'CANCELLED') {
                    <span class="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs"
                      >Cancelled</span
                    >
                  }
                </p>
                <p class="text-slate-600">
                  <a class="underline" [href]="'tel:' + b.customerPhone">{{ b.customerPhone }}</a> ·
                  @if (b.customerEmail) {
                    <a class="underline" [href]="'mailto:' + b.customerEmail">{{
                      b.customerEmail
                    }}</a>
                    ·
                  }
                  {{ b.hallName }}
                </p>
              </div>
              @if (b.status === 'ACTIVE') {
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="rounded-full border border-slate-300 bg-white px-3 py-1"
                    (click)="edit(b)"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="rounded-full border border-red-300 bg-white px-3 py-1 text-red-700"
                    (click)="cancel(b)"
                  >
                    Cancel booking
                  </button>
                </div>
              }
            </div>
            <p class="mt-2">
              @for (s of b.slots; track s.eventDate + s.slot) {
                <span
                  class="mr-1 inline-block rounded-full bg-forest-50 px-2 py-0.5 text-xs text-forest-800 ring-1 ring-forest-200"
                >
                  {{ dayLabel(s.eventDate) }} · {{ slotLabels[s.slot] }}
                </span>
              }
            </p>
            @if (b.amountPaise !== null || b.advancePaise !== null) {
              <p class="mt-2 text-slate-700 tabular-nums">
                @if (b.amountPaise !== null) {
                  Amount {{ b.amountPaise | inr }}
                }
                @if (b.advancePaise !== null) {
                  · Advance {{ b.advancePaise | inr }}
                }
                @if (b.amountPaise !== null && b.advancePaise !== null) {
                  · Balance {{ b.amountPaise - b.advancePaise | inr }}
                }
              </p>
            }
            @if (b.notes) {
              <p class="mt-1 text-slate-600">{{ b.notes }}</p>
            }
          </li>
        } @empty {
          <li
            class="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-600"
          >
            No offline bookings recorded.
          </li>
        }
      </ul>
    </section>
  `,
})
export class OfflineBookings {
  private readonly api = inject(OwnerApi);
  readonly venueId = input.required<string>();
  readonly halls = input.required<Hall[]>();
  /** Fired after any change, so the calendar can reload. */
  readonly changed = output();

  protected readonly input = 'rounded-xl border border-slate-300 bg-white px-3 py-2';
  protected readonly slotList = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly eventTypes = EVENT_TYPES;
  protected readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(),
  );

  protected readonly items = signal<OfflineBooking[]>([]);
  protected readonly showCancelled = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<OfflineBooking | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  // Built empty here: inputs (the hall list) aren't available until after construction.
  protected draft: Draft = this.blank('');

  protected readonly visible = computed(() =>
    this.items().filter((b) => this.showCancelled() || b.status === 'ACTIVE'),
  );

  constructor() {
    effect(() => {
      void this.load(this.venueId());
    });
  }

  private blank(hallId = this.halls()[0]?.id ?? ''): Draft {
    return {
      hallId,
      slots: [{ eventDate: '', slot: 'FULL_DAY' }],
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      eventType: '',
      amountRupees: null,
      advanceRupees: null,
      notes: '',
    };
  }

  private async load(venueId: string): Promise<void> {
    try {
      this.items.set((await this.api.offlineBookings(venueId, 'ALL')).items);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load offline bookings.'));
    }
  }

  protected open(): void {
    this.editing.set(null);
    this.draft = this.blank();
    this.error.set(null);
    this.formOpen.set(true);
  }

  protected edit(b: OfflineBooking): void {
    this.editing.set(b);
    this.draft = {
      hallId: b.hallId,
      slots: b.slots.map((s) => ({ ...s })),
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      customerEmail: b.customerEmail ?? '',
      eventType: b.eventType ?? '',
      amountRupees: b.amountPaise === null ? null : b.amountPaise / 100,
      advanceRupees: b.advancePaise === null ? null : b.advancePaise / 100,
      notes: b.notes ?? '',
    };
    this.error.set(null);
    this.formOpen.set(true);
  }

  protected close(): void {
    this.formOpen.set(false);
    this.editing.set(null);
  }

  protected addDate(): void {
    const last = this.draft.slots.at(-1);
    this.draft.slots.push({ eventDate: '', slot: last?.slot ?? 'FULL_DAY' });
  }

  protected dayLabel(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected async save(): Promise<void> {
    const d = this.draft;
    const problem = this.check(d);
    if (problem) {
      this.error.set(problem);
      return;
    }
    const details = {
      customerName: d.customerName.trim(),
      customerPhone: d.customerPhone,
      ...(d.customerEmail.trim() ? { customerEmail: d.customerEmail.trim() } : {}),
      ...(d.eventType.trim() ? { eventType: d.eventType.trim() } : {}),
      ...(d.amountRupees !== null ? { amountPaise: rupeesToPaiseInput(d.amountRupees) } : {}),
      ...(d.advanceRupees !== null ? { advancePaise: rupeesToPaiseInput(d.advanceRupees) } : {}),
      ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const current = this.editing();
      if (current) await this.api.updateOfflineBooking(current.id, details);
      else
        await this.api.addOfflineBooking(this.venueId(), {
          hallId: d.hallId,
          slots: d.slots,
          ...details,
        });
      this.close();
      await this.load(this.venueId());
      this.changed.emit();
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not save the booking.'));
    } finally {
      this.busy.set(false);
    }
  }

  /** The checks a person can fix before sending; the server checks everything again. */
  private check(d: Draft): string | null {
    if (!this.editing() && d.slots.some((s) => !s.eventDate)) return 'Choose a date for each row.';
    if (!this.editing() && d.slots.some((s) => s.eventDate < this.today))
      return 'Dates must be today or later.';
    if (d.customerName.trim().length < 2) return "Enter the guest's name.";
    if (!normalizeIndianMobile(d.customerPhone))
      return 'Enter a valid 10-digit Indian mobile number.';
    if (d.customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.customerEmail.trim()))
      return "Check the guest's email address.";
    if (d.amountRupees !== null && d.advanceRupees !== null && d.advanceRupees > d.amountRupees)
      return 'The advance cannot be more than the amount.';
    return null;
  }

  protected async cancel(b: OfflineBooking): Promise<void> {
    const dates = b.slots.map((s) => this.dayLabel(s.eventDate)).join(', ');
    if (!confirm(`Cancel ${b.customerName}'s booking and free ${dates}?`)) return;
    try {
      await this.api.cancelOfflineBooking(b.id);
      await this.load(this.venueId());
      this.changed.emit();
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not cancel the booking.'));
    }
  }
}
