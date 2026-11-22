import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ReportSummary } from '@mandapambook/shared';
import { errorMessage } from '../../core/auth/auth.service';
import { FileDownload } from '../../core/file-download';
import {
  type AdminReview,
  InsightsApi,
  type PayoutRow,
  type PayoutStatus,
} from '../../core/insights-api.service';
import { InrPipe } from '../../shared/inr.pipe';
import { currentFinancialYear } from '../owner/insights';

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

@Component({
  selector: 'app-admin-reports',
  imports: [DatePipe, FormsModule, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <h1 class="font-display text-2xl font-bold">Reports</h1>
        <div class="flex flex-wrap items-end gap-2 text-sm">
          <label class="flex flex-col"
            >From
            <input
              type="date"
              class="rounded-md border border-slate-300 px-2 py-1.5"
              [(ngModel)]="from"
          /></label>
          <label class="flex flex-col"
            >To
            <input
              type="date"
              class="rounded-md border border-slate-300 px-2 py-1.5"
              [(ngModel)]="to"
          /></label>
          <button
            type="button"
            class="rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white"
            (click)="load()"
          >
            Show
          </button>
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5"
            [disabled]="exporting()"
            (click)="exportCsv()"
          >
            {{ exporting() ? 'Exporting…' : 'Export CSV' }}
          </button>
        </div>
      </header>

      @if (s(); as s) {
        <p class="text-sm text-slate-600">
          Events from {{ s.from | date: 'd MMM y' }} to {{ s.to | date: 'd MMM y' }}
        </p>
        <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          @for (m of metrics(s); track m.label) {
            <div class="rounded-lg bg-white p-3 ring-1 ring-slate-200">
              <dt class="text-slate-600">{{ m.label }}</dt>
              <dd class="text-lg font-semibold tabular-nums">{{ m.value | inr }}</dd>
            </div>
          }
        </dl>
        <div class="grid gap-4 sm:grid-cols-2">
          <section
            aria-labelledby="status-h"
            class="rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200"
          >
            <h2 id="status-h" class="font-semibold">Bookings by status</h2>
            <ul class="mt-1 tabular-nums">
              @for (e of statusEntries(s); track e[0]) {
                <li class="flex justify-between">
                  <span>{{ e[0] }}</span><span>{{ e[1] }}</span>
                </li>
              } @empty {
                <li class="text-slate-600">No bookings in this window.</li>
              }
            </ul>
          </section>
          <section
            aria-labelledby="cities-h"
            class="rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200"
          >
            <h2 id="cities-h" class="font-semibold">Top cities</h2>
            <ol class="mt-1 tabular-nums">
              @for (c of s.topCities; track c.city) {
                <li class="flex justify-between gap-2">
                  <span>{{ c.city }} ({{ c.bookings }})</span><span>{{ c.valuePaise | inr }}</span>
                </li>
              } @empty {
                <li class="text-slate-600">No bookings in this window.</li>
              }
            </ol>
          </section>
        </div>
      }
      @if (error()) {
        <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
    </section>
  `,
})
export class AdminReports implements OnInit {
  private readonly api = inject(InsightsApi);
  private readonly files = inject(FileDownload);
  private readonly fy = currentFinancialYear(today());
  protected from = this.fy.from;
  protected to = this.fy.to;
  protected readonly s = signal<ReportSummary | null>(null);
  protected readonly exporting = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected metrics(s: ReportSummary): { label: string; value: number }[] {
    return [
      { label: 'Booking value (incl. GST)', value: s.bookingValuePaise },
      { label: 'Collected online', value: s.collectedOnlinePaise },
      { label: 'Refunded', value: s.refundedPaise },
      { label: 'Platform fees', value: s.platformFeesPaise },
      { label: 'Commission', value: s.commissionPaise },
      { label: 'Payouts pending', value: s.payoutsPendingPaise },
      { label: 'Payouts paid', value: s.payoutsPaidPaise },
    ];
  }

  protected statusEntries(s: ReportSummary): [string, number][] {
    return Object.entries(s.bookingsByStatus).sort((a, b) => b[1] - a[1]);
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.s.set(await this.api.summary({ from: this.from, to: this.to }));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async exportCsv(): Promise<void> {
    this.exporting.set(true);
    this.error.set(null);
    try {
      await this.files.download(this.api.csvUrl({ from: this.from, to: this.to }), 'bookings.csv');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.exporting.set(false);
    }
  }
}

@Component({
  selector: 'app-admin-payouts',
  imports: [DatePipe, FormsModule, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <h1 class="font-display text-2xl font-bold">Owner payouts</h1>
        <label class="flex flex-col text-sm"
          >Status
          <select
            class="rounded-md border border-slate-300 px-2 py-1.5"
            [ngModel]="status()"
            (ngModelChange)="status.set($event); load()"
          >
            <option value="PENDING">Pending</option>
            <option value="PAID">Paid</option>
            <option value="ON_HOLD">On hold</option>
          </select>
        </label>
      </header>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[40rem] text-left text-sm">
          <caption class="sr-only">
            Payouts
          </caption>
          <thead class="text-slate-600">
            <tr>
              <th class="py-2 pr-3">Event</th>
              <th class="pr-3">Venue</th>
              <th class="pr-3 text-right">Net to owner</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody class="tabular-nums">
            @for (p of items(); track p.id) {
              <tr class="border-t border-slate-200 align-top">
                <td class="py-2 pr-3">{{ p.eventDate | date: 'd MMM y' }} · {{ p.refCode }}</td>
                <td class="pr-3">{{ p.venueName }}</td>
                <td class="pr-3 text-right font-semibold">{{ p.netPaise | inr }}</td>
                <td class="py-1">
                  @if (p.status === 'PAID') {
                    Paid {{ p.paidAt | date: 'd MMM' }} · {{ p.reference }}
                  } @else {
                    <form class="flex gap-1" (submit)="$event.preventDefault(); pay(p)">
                      <label class="sr-only" [for]="'ref-' + p.id">Transfer reference</label>
                      <input
                        [id]="'ref-' + p.id"
                        class="w-36 rounded-md border border-slate-300 px-2 py-1"
                        placeholder="UTR / reference"
                        [(ngModel)]="refs[p.id]"
                        [name]="'ref-' + p.id"
                      />
                      <button
                        class="rounded-md bg-brand-600 px-2 py-1 font-semibold text-white disabled:opacity-50"
                        [disabled]="!refs[p.id]?.trim()"
                      >
                        Mark paid
                      </button>
                    </form>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="py-4 text-slate-600">No payouts with this status.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (error()) {
        <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
    </section>
  `,
})
export class AdminPayouts implements OnInit {
  private readonly api = inject(InsightsApi);
  protected readonly status = signal<PayoutStatus>('PENDING');
  protected readonly items = signal<PayoutRow[]>([]);
  protected readonly error = signal<string | null>(null);
  protected refs: Record<string, string> = {};

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.items.set((await this.api.payouts(this.status())).items);
  }

  protected async pay(p: PayoutRow): Promise<void> {
    this.error.set(null);
    try {
      await this.api.markPaid(p.id, (this.refs[p.id] ?? '').trim());
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

@Component({
  selector: 'app-admin-reviews',
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <h1 class="font-display text-2xl font-bold">Review moderation</h1>
        <label class="flex flex-col text-sm"
          >Show
          <select
            class="rounded-md border border-slate-300 px-2 py-1.5"
            [ngModel]="status()"
            (ngModelChange)="status.set($event); load()"
          >
            <option value="PUBLISHED">Published</option>
            <option value="HIDDEN">Hidden</option>
          </select>
        </label>
      </header>
      <ul class="flex flex-col gap-3">
        @for (r of items(); track r.id) {
          <li class="flex flex-col gap-2 rounded-lg bg-white p-4 text-sm ring-1 ring-slate-200">
            <p class="flex flex-wrap justify-between gap-2">
              <span class="font-semibold">{{ r.rating }}/5 · {{ r.venueName }}</span>
              <span class="text-slate-500"
                >{{ r.customerName }} · {{ r.createdAt | date: 'd MMM y' }}</span
              >
            </p>
            @if (r.body) {
              <p class="whitespace-pre-line">{{ r.body }}</p>
            }
            <form class="flex flex-wrap items-end gap-2" (submit)="$event.preventDefault(); act(r)">
              <label class="flex flex-col"
                >Reason (recorded in the audit log)
                <input
                  class="rounded-md border border-slate-300 px-2 py-1"
                  [(ngModel)]="reasons[r.id]"
                  [name]="'reason-' + r.id"
              /></label>
              <button
                class="rounded-md border px-3 py-1 font-semibold disabled:opacity-50"
                [class.border-red-300]="r.status === 'PUBLISHED'"
                [class.text-red-700]="r.status === 'PUBLISHED'"
                [disabled]="(reasons[r.id] ?? '').trim().length < 3"
              >
                {{ r.status === 'PUBLISHED' ? 'Hide' : 'Restore' }}
              </button>
            </form>
          </li>
        } @empty {
          <li class="text-slate-600">Nothing here.</li>
        }
      </ul>
      @if (error()) {
        <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
    </section>
  `,
})
export class AdminReviews implements OnInit {
  private readonly api = inject(InsightsApi);
  protected readonly status = signal<'PUBLISHED' | 'HIDDEN'>('PUBLISHED');
  protected readonly items = signal<AdminReview[]>([]);
  protected readonly error = signal<string | null>(null);
  protected reasons: Record<string, string> = {};

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.items.set((await this.api.adminReviews(this.status())).items);
  }

  protected async act(r: AdminReview): Promise<void> {
    this.error.set(null);
    try {
      await this.api.moderate(
        r.id,
        r.status === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED',
        (this.reasons[r.id] ?? '').trim(),
      );
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
