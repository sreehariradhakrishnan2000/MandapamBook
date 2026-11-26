import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { OwnerProfileView } from '@mandapambook/shared';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { BookingApi, type OwnerBooking } from '../../core/booking-api.service';
import { OwnerApi, type VenueSummary } from '../../core/owner-api.service';
import { StatusChip } from './status-chip';

@Component({
  selector: 'app-owner-dashboard',
  imports: [DatePipe, RouterLink, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-6 py-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="font-display text-3xl font-medium">My venues</h1>
        <nav class="flex gap-2 text-sm" aria-label="Venue tools">
          <a
            routerLink="bookings"
            class="rounded-full border border-slate-300 px-3 py-2 font-medium"
            >Bookings</a
          >
          <a routerLink="reviews" class="rounded-full border border-slate-300 px-3 py-2 font-medium"
            >Reviews</a
          >
          @if (isOwner) {
            <a
              routerLink="earnings"
              class="rounded-full border border-slate-300 px-3 py-2 font-medium"
              >Earnings</a
            >
          }
        </nav>
        @if (isOwner) {
          <div class="flex gap-3 text-sm">
            <a
              routerLink="profile"
              class="rounded-full border border-slate-300 px-3 py-2 font-medium"
              >Business & payout details</a
            >
            <a routerLink="staff" class="rounded-full border border-slate-300 px-3 py-2 font-medium"
              >Staff</a
            >
            <a
              routerLink="venues/new"
              class="rounded-full bg-brand-600 px-3 py-2 font-semibold text-white"
              >Add a venue</a
            >
          </div>
        }
      </header>

      @if (isOwner && profile()?.kycStatus === 'NOT_STARTED') {
        <p class="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Add your PAN and bank details before submitting a venue for review.
          <a routerLink="profile" class="font-semibold underline">Add details</a>
        </p>
      }
      @if (error()) {
        <p class="text-sm text-red-700" role="alert">{{ error() }}</p>
      }

      @if (glance(); as g) {
        <section aria-labelledby="glance-h">
          <h2 id="glance-h" class="sr-only">At a glance</h2>
          <ul class="grid gap-3 sm:grid-cols-3">
            <li>
              <a
                routerLink="bookings"
                class="flex h-full flex-col gap-1 rounded-2xl border p-4"
                [class.border-brand-300]="g.waiting > 0"
                [class.bg-brand-50]="g.waiting > 0"
                [class.border-slate-200]="g.waiting === 0"
                [class.bg-white]="g.waiting === 0"
              >
                <span class="text-sm text-slate-600">Waiting for your answer</span>
                <span class="font-display text-3xl tabular-nums">{{ g.waiting }}</span>
                <span class="text-xs" [class.text-brand-800]="g.waiting > 0">
                  {{
                    g.waiting > 0
                      ? 'Answer within 24 hours, or they are refunded automatically'
                      : 'No requests right now'
                  }}
                </span>
              </a>
            </li>
            <li>
              <a
                routerLink="bookings"
                class="flex h-full flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-4"
              >
                <span class="text-sm text-slate-600">Events in the next 30 days</span>
                <span class="font-display text-3xl tabular-nums">{{ g.upcoming }}</span>
                <span class="text-xs text-slate-600">
                  @if (g.next; as n) {
                    Next: {{ n.eventDate | date: 'EEE d MMM' }} · {{ n.hallName }}
                  } @else {
                    Nothing booked yet
                  }
                </span>
              </a>
            </li>
            <li class="flex h-full flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-4">
              <span class="text-sm text-slate-600">Venues live</span>
              <span class="font-display text-3xl tabular-nums"
                >{{ g.live
                }}<span class="text-lg text-slate-500"> of {{ venues().length }}</span></span
              >
              <span class="text-xs text-slate-600">Visible to customers in search</span>
            </li>
          </ul>
        </section>
      }

      <ul class="grid gap-3 sm:grid-cols-2">
        @for (v of venues(); track v.id) {
          <li class="rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex items-start justify-between gap-3">
              <a [routerLink]="['venues', v.id]" class="font-semibold hover:text-brand-700">{{
                v.name
              }}</a>
              <app-status-chip [status]="v.status" />
            </div>
            @if (v.status === 'REJECTED' && v.rejectionReason) {
              <p class="mt-2 text-sm text-red-700">{{ v.rejectionReason }}</p>
            }
          </li>
        } @empty {
          @if (!loading()) {
            <li class="rounded-2xl border border-dashed border-slate-300 p-6 text-slate-600">
              No venues yet.
              @if (isOwner) {
                <a routerLink="venues/new" class="font-semibold text-brand-700 underline"
                  >Add your first venue</a
                >.
              }
            </li>
          }
        }
      </ul>
    </section>
  `,
})
export class OwnerDashboard implements OnInit {
  private readonly api = inject(OwnerApi);
  protected readonly isOwner = inject(AuthService).hasPermission('auditorium:create');
  protected readonly venues = signal<VenueSummary[]>([]);
  protected readonly profile = signal<OwnerProfileView | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private readonly bookings = inject(BookingApi);
  /** The owner's day at a glance: requests to answer, events coming up, venues live. */
  protected readonly glance = signal<{
    waiting: number;
    upcoming: number;
    next: OwnerBooking | null;
    live: number;
  } | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const [venues, profile, bookings] = await Promise.all([
        this.api.venues(),
        this.isOwner ? this.api.profile() : Promise.resolve(null),
        this.bookings.ownerBookings().catch(() => null),
      ]);
      this.venues.set(venues.items);
      this.profile.set(profile);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
        new Date(),
      );
      const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const items = bookings?.items ?? [];
      const upcoming = items
        .filter((b) => b.status === 'CONFIRMED' && b.eventDate >= today && b.eventDate <= in30)
        .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
      this.glance.set({
        waiting: items.filter((b) => b.status === 'AWAITING_OWNER').length,
        upcoming: upcoming.length,
        next: upcoming[0] ?? null,
        live: venues.items.filter((v) => v.status === 'APPROVED').length,
      });
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load your venues.'));
    } finally {
      this.loading.set(false);
    }
  }
}
