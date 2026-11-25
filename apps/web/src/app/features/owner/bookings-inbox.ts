import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import {
  BookingApi,
  type BookingStatus,
  type OwnerBooking,
  SLOT_LABELS,
  STATUS_LABELS,
} from '../../core/booking-api.service';
import { InrPipe } from '../../shared/inr.pipe';

@Component({
  selector: 'app-owner-bookings',
  imports: [DatePipe, FormsModule, RouterLink, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <a routerLink="/owner" class="tap w-fit text-sm text-brand-700 underline">← My venues</a>
      <h1 class="font-display text-3xl font-medium">Bookings</h1>
      <label class="text-sm"
        >Show
        <select
          class="ml-1 rounded-xl border border-slate-300 px-2 py-1.5"
          [(ngModel)]="status"
          (ngModelChange)="load()"
        >
          <option value="">All</option>
          @for (s of statuses; track s) {
            <option [value]="s">{{ statusLabels[s] }}</option>
          }
        </select>
      </label>
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
      <ul class="flex flex-col gap-2">
        @for (b of items(); track b.id) {
          <li
            class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm"
          >
            <span class="min-w-0">
              <span class="block font-semibold"
                >{{ b.eventDate | date: 'EEE, d MMM y' }} · {{ slotLabels[b.slot] }} ·
                {{ b.hallName }}</span
              >
              <span class="block text-slate-600"
                >{{ b.venueName }} · {{ b.guestCount }} guests · {{ b.refCode }}</span
              >
              @if (b.customer; as c) {
                <span class="block text-slate-600">{{ c.name }} · {{ c.phone ?? c.email }}</span>
              } @else {
                <span class="block text-slate-500">Customer details appear once paid</span>
              }
            </span>
            <span class="flex flex-col items-end gap-1">
              <span class="font-semibold">{{ statusLabels[b.status] }}</span>
              <span class="tabular-nums text-slate-600">{{ b.totalPaise | inr }}</span>
              @if (canApprove && b.status === 'AWAITING_OWNER') {
                <button
                  type="button"
                  class="rounded-full bg-leaf-600 px-3 py-1 font-semibold text-white"
                  (click)="accept(b)"
                >
                  Accept
                </button>
              }
              @if (canApprove && b.status === 'CONFIRMED') {
                <button
                  type="button"
                  class="rounded-full border border-slate-300 px-3 py-1"
                  (click)="markPaid(b)"
                >
                  Balance received
                </button>
              }
            </span>
          </li>
        } @empty {
          <li class="rounded-2xl border border-dashed border-slate-300 p-6 text-slate-600">
            No bookings yet.
          </li>
        }
      </ul>
    </section>
  `,
})
export class OwnerBookingsInbox implements OnInit {
  private readonly api = inject(BookingApi);
  protected readonly canApprove = inject(AuthService).hasPermission('booking:approve');
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statuses = Object.keys(STATUS_LABELS) as BookingStatus[];
  protected status: BookingStatus | '' = '';
  protected readonly items = signal<OwnerBooking[]>([]);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async load(): Promise<void> {
    this.items.set((await this.api.ownerBookings(this.status || undefined)).items);
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await fn();
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected accept = (b: OwnerBooking) => this.run(() => this.api.accept(b.id));
  protected markPaid = (b: OwnerBooking) => this.run(() => this.api.balanceReceived(b.id));
}
