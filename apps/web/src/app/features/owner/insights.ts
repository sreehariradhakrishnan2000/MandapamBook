import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { OwnerEarnings } from '@mandapambook/shared';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { InsightsApi, type OwnerReview, type PayoutRow } from '../../core/insights-api.service';
import { InrPipe } from '../../shared/inr.pipe';

export interface FinancialYear {
  label: string;
  from: string;
  to: string;
}

/** The Indian financial year (April to March) that is `yearsBack` years before today's. */
export function currentFinancialYear(today: string, yearsBack = 0): FinancialYear {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const s = (m >= 4 ? y : y - 1) - yearsBack;
  return {
    label: `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`,
    from: `${s}-04-01`,
    to: `${s + 1}-03-31`,
  };
}

/** Recent financial years, newest first, for a select. */
export function financialYears(today: string, count = 3): FinancialYear[] {
  return Array.from({ length: count }, (_, i) => currentFinancialYear(today, i));
}

const PAYOUT_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  SCHEDULED: 'Scheduled',
  PAID: 'Paid',
  ON_HOLD: 'On hold',
};

@Component({
  selector: 'app-owner-earnings',
  imports: [DatePipe, FormsModule, RouterLink, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <a routerLink="/owner" class="text-sm text-brand-700 underline">← My venues</a>
      <header class="flex flex-wrap items-end justify-between gap-3">
        <h1 class="font-display text-3xl font-medium">Earnings</h1>
        <label class="flex flex-col text-sm"
          >Financial year
          <select
            class="rounded-xl border border-slate-300 px-2 py-1.5"
            [compareWith]="sameYear"
            [ngModel]="fy()"
            (ngModelChange)="fy.set($event); load()"
          >
            @for (y of years; track y.from) {
              <option [ngValue]="y">{{ y.label }}</option>
            }
          </select>
        </label>
      </header>

      @if (s(); as s) {
        <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div class="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <dt class="text-slate-600">Bookings</dt>
            <dd class="text-xl font-semibold tabular-nums">{{ s.bookings }}</dd>
          </div>
          <div class="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <dt class="text-slate-600">Booking value</dt>
            <dd class="text-xl font-semibold tabular-nums">{{ s.bookingValuePaise | inr }}</dd>
          </div>
          <div class="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <dt class="text-slate-600">Due to you</dt>
            <dd class="text-xl font-semibold tabular-nums">{{ s.pendingPaise | inr }}</dd>
          </div>
          <div class="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <dt class="text-slate-600">Paid out</dt>
            <dd class="text-xl font-semibold tabular-nums">{{ s.paidOutPaise | inr }}</dd>
          </div>
        </dl>
        <p class="text-sm text-slate-600">
          From online advances of {{ s.collectedOnlinePaise | inr }}, platform commission was
          {{ s.commissionPaise | inr }}. Balances collected at the venue are not included.
        </p>
      }

      <div class="overflow-x-auto">
        <table class="w-full min-w-[36rem] text-left text-sm">
          <caption class="sr-only">
            Payouts by booking
          </caption>
          <thead class="text-slate-600">
            <tr>
              <th class="py-2 pr-3">Event</th>
              <th class="pr-3">Venue</th>
              <th class="pr-3 text-right">Collected</th>
              <th class="pr-3 text-right">Commission</th>
              <th class="pr-3 text-right">Net</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody class="tabular-nums">
            @for (p of payouts(); track p.id) {
              <tr class="border-t border-slate-200">
                <td class="py-2 pr-3">{{ p.eventDate | date: 'd MMM y' }} · {{ p.refCode }}</td>
                <td class="pr-3">{{ p.venueName }}</td>
                <td class="pr-3 text-right">{{ p.grossPaise | inr }}</td>
                <td class="pr-3 text-right">{{ p.commissionPaise | inr }}</td>
                <td class="pr-3 text-right font-semibold">{{ p.netPaise | inr }}</td>
                <td>
                  {{ labels[p.status] }}
                  @if (p.reference) {
                    <span class="block text-xs text-slate-500">Ref {{ p.reference }}</span>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="py-4 text-slate-600">
                  No payouts yet. A payout is created after each event.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
    </section>
  `,
})
export class OwnerEarningsPage implements OnInit {
  private readonly api = inject(InsightsApi);
  protected readonly labels = PAYOUT_LABELS;
  private readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(),
  );
  protected readonly years = financialYears(this.today);
  protected readonly fy = signal(currentFinancialYear(this.today));
  protected readonly sameYear = (a: FinancialYear | null, b: FinancialYear | null) =>
    a?.from === b?.from;
  protected readonly s = signal<OwnerEarnings | null>(null);
  protected readonly payouts = signal<PayoutRow[]>([]);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      const { from, to } = this.fy();
      const res = await this.api.earnings({ from, to });
      this.s.set(res.summary);
      this.payouts.set(res.payouts);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

@Component({
  selector: 'app-owner-reviews',
  imports: [DatePipe, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <a routerLink="/owner" class="text-sm text-brand-700 underline">← My venues</a>
      <h1 class="font-display text-3xl font-medium">Reviews</h1>
      <ul class="flex flex-col gap-3">
        @for (r of items(); track r.id) {
          <li class="flex flex-col gap-2 rounded-2xl bg-white p-4 text-sm ring-1 ring-slate-200">
            <p class="flex flex-wrap justify-between gap-2">
              <span class="font-semibold"
                ><span class="text-amber-500" [attr.aria-label]="r.rating + ' out of 5'">{{
                  '★★★★★'.slice(0, r.rating)
                }}</span>
                {{ r.author }} · {{ r.venueName }}</span
              >
              <span class="text-slate-500"
                >{{ r.createdAt | date: 'd MMM y' }}
                @if (r.status !== 'PUBLISHED') {
                  · Hidden by MandapamBook
                }
              </span>
            </p>
            @if (r.body) {
              <p class="whitespace-pre-line">{{ r.body }}</p>
            }
            @if (r.ownerReply) {
              <p class="border-l-2 border-brand-500 pl-2 text-slate-700">
                <span class="font-semibold">Your reply:</span> {{ r.ownerReply }}
              </p>
            }
            @if (canReply) {
              @if (editing() === r.id) {
                <label class="flex flex-col gap-1"
                  >Public reply
                  <textarea
                    class="rounded-xl border border-slate-300 px-2 py-1.5"
                    rows="2"
                    maxlength="1000"
                    [(ngModel)]="draft"
                  ></textarea>
                </label>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                    [disabled]="!draft.trim()"
                    (click)="send(r.id)"
                  >
                    Post reply
                  </button>
                  <button
                    type="button"
                    class="rounded-full border border-slate-300 px-3 py-1.5"
                    (click)="editing.set(null)"
                  >
                    Cancel
                  </button>
                </div>
              } @else {
                <button
                  type="button"
                  class="w-fit text-brand-700 underline"
                  (click)="startReply(r)"
                >
                  {{ r.ownerReply ? 'Edit reply' : 'Reply' }}
                </button>
              }
            }
          </li>
        } @empty {
          <li class="text-slate-600">No reviews yet.</li>
        }
      </ul>
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
    </section>
  `,
})
export class OwnerReviewsPage implements OnInit {
  private readonly api = inject(InsightsApi);
  protected readonly canReply = inject(AuthService).hasPermission('review:reply');
  protected readonly items = signal<OwnerReview[]>([]);
  protected readonly editing = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected draft = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.items.set((await this.api.ownerReviews()).items);
  }

  protected startReply(r: OwnerReview): void {
    this.draft = r.ownerReply ?? '';
    this.editing.set(r.id);
  }

  protected async send(id: string): Promise<void> {
    this.error.set(null);
    try {
      await this.api.reply(id, this.draft.trim());
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
