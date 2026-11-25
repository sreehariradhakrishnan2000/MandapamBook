import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SLOTS, type Slot } from '@mandapambook/shared';
import { errorMessage } from '../../../core/auth/auth.service';
import { type CalendarEntry, type Hall, OwnerApi } from '../../../core/owner-api.service';
import { SLOT_LABELS } from './halls-pricing';

/** YYYY-MM-DD for a local calendar date (no timezone shifting). */
export function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

@Component({
  selector: 'app-venue-calendar',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      @if (halls().length === 0) {
        <p class="text-slate-600">Add a hall first.</p>
      } @else {
        <div class="flex flex-wrap items-center gap-3">
          <label class="text-sm"
            >Hall
            <select
              class="ml-1 rounded-xl border border-slate-300 px-2 py-1.5 text-base sm:text-sm"
              [ngModel]="hallId()"
              (ngModelChange)="hallId.set($event)"
            >
              @for (h of halls(); track h.id) {
                <option [value]="h.id">{{ h.name }}</option>
              }
            </select>
          </label>
          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="shift(-1)"
              class="rounded-full border border-slate-300 bg-white px-3 py-1 hover:border-slate-400"
              aria-label="Previous month"
            >
              ‹
            </button>
            <span class="min-w-32 text-center font-semibold" aria-live="polite">{{
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
        @if (error()) {
          <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {{ error() }}
          </p>
        }

        <ul class="grid grid-cols-1 gap-1 sm:grid-cols-2">
          @for (d of days(); track d.date) {
            <li
              class="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span class="tabular-nums">{{ d.label }}</span>
              <span class="flex flex-wrap gap-1">
                @for (e of d.entries; track e.slot) {
                  <span
                    class="rounded px-2 py-0.5 text-xs"
                    [class]="
                      e.kind === 'BOOKING'
                        ? 'bg-brand-50 text-brand-700'
                        : e.kind === 'OFFLINE'
                          ? 'bg-forest-50 text-forest-800'
                          : 'bg-slate-200 text-slate-700'
                    "
                  >
                    {{ slotLabels[e.slot] }}:
                    @switch (e.kind) {
                      @case ('BOOKING') {
                        Booked
                      }
                      @case ('OFFLINE') {
                        Booked offline · {{ e.customerName }}
                      }
                      @default {
                        Blocked
                      }
                    }
                    @if (e.kind === 'BLOCK' && e.blockId) {
                      <button
                        type="button"
                        class="-my-2 ml-1 px-1.5 py-2 underline"
                        (click)="unblock(e.blockId)"
                      >
                        Unblock
                      </button>
                    }
                  </span>
                }
              </span>
            </li>
          }
        </ul>

        <form class="flex flex-wrap items-end gap-2 text-sm" (ngSubmit)="block()">
          <label class="flex flex-col gap-1"
            >Date<input
              type="date"
              name="date"
              required
              class="rounded-xl border border-slate-300 px-2 py-1.5 text-base sm:text-sm"
              [(ngModel)]="blockDate"
          /></label>
          <label class="flex flex-col gap-1"
            >Slot
            <select
              name="slot"
              class="rounded-xl border border-slate-300 px-2 py-1.5 text-base sm:text-sm"
              [(ngModel)]="blockSlot"
            >
              @for (s of slots; track s) {
                <option [value]="s">{{ slotLabels[s] }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col gap-1"
            >Reason (optional)<input
              name="reason"
              maxlength="200"
              class="rounded-xl border border-slate-300 px-2 py-1.5 text-base sm:text-sm"
              [(ngModel)]="blockReason"
          /></label>
          <button
            type="submit"
            class="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white"
          >
            Block date
          </button>
        </form>
      }
    </div>
  `,
})
export class VenueCalendar {
  private readonly api = inject(OwnerApi);
  readonly halls = input.required<Hall[]>();

  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly hallId = signal<string | null>(null);
  protected readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected readonly entries = signal<CalendarEntry[]>([]);
  protected readonly error = signal<string | null>(null);
  protected blockDate = '';
  protected blockSlot: Slot = 'FULL_DAY';
  protected blockReason = '';

  protected readonly monthLabel = computed(() =>
    this.month().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
  );

  /** Only days with something on them, to keep the list short on phones. */
  protected readonly days = computed(() => {
    const byDate = new Map<string, CalendarEntry[]>();
    for (const e of this.entries())
      byDate.set(e.eventDate, [...(byDate.get(e.eventDate) ?? []), e]);
    return [...byDate.entries()].map(([date, entries]) => ({
      date,
      entries,
      label: new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    }));
  });

  constructor() {
    effect(() => {
      const first = this.halls()[0];
      if (first && !this.hallId()) this.hallId.set(first.id);
    });
    effect(() => {
      const id = this.hallId();
      const m = this.month();
      if (id) void this.load(id, m);
    });
  }

  private async load(hallId: string, m: Date): Promise<void> {
    const from = isoDate(m.getFullYear(), m.getMonth(), 1);
    const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const to = isoDate(m.getFullYear(), m.getMonth(), last);
    try {
      this.entries.set((await this.api.calendar(hallId, from, to)).items);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  /** Reloads the visible month, e.g. after an offline booking was added or cancelled. */
  refresh(): void {
    const id = this.hallId();
    if (id) void this.load(id, this.month());
  }

  protected shift(by: number): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + by, 1));
  }

  protected async block(): Promise<void> {
    const id = this.hallId();
    if (!id || !this.blockDate) return;
    try {
      await this.api.block(
        id,
        this.blockDate,
        this.blockSlot,
        this.blockReason.trim() || undefined,
      );
      this.error.set(null);
      this.blockReason = '';
      await this.load(id, this.month());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async unblock(blockId: string): Promise<void> {
    await this.api.unblock(blockId);
    const id = this.hallId();
    if (id) await this.load(id, this.month());
  }
}
