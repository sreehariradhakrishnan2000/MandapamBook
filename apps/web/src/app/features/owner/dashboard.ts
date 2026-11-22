import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { OwnerProfileView } from '@mandapambook/shared';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { OwnerApi, type VenueSummary } from '../../core/owner-api.service';
import { StatusChip } from './status-chip';

@Component({
  selector: 'app-owner-dashboard',
  imports: [RouterLink, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-6 py-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="font-display text-2xl font-bold">My venues</h1>
        <a
          routerLink="bookings"
          class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium"
          >Bookings</a
        >
        @if (isOwner) {
          <div class="flex gap-3 text-sm">
            <a routerLink="profile" class="rounded-md border border-slate-300 px-3 py-2 font-medium"
              >Business & payout details</a
            >
            <a routerLink="staff" class="rounded-md border border-slate-300 px-3 py-2 font-medium"
              >Staff</a
            >
            <a
              routerLink="venues/new"
              class="rounded-md bg-brand-600 px-3 py-2 font-semibold text-white"
              >Add a venue</a
            >
          </div>
        }
      </header>

      @if (isOwner && profile()?.kycStatus === 'NOT_STARTED') {
        <p class="rounded-md bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Add your PAN and bank details before submitting a venue for review.
          <a routerLink="profile" class="font-semibold underline">Add details</a>
        </p>
      }
      @if (error()) {
        <p class="text-sm text-red-700" role="alert">{{ error() }}</p>
      }

      <ul class="grid gap-3 sm:grid-cols-2">
        @for (v of venues(); track v.id) {
          <li class="rounded-lg border border-slate-200 bg-white p-4">
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
            <li class="rounded-lg border border-dashed border-slate-300 p-6 text-slate-600">
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

  async ngOnInit(): Promise<void> {
    try {
      const [venues, profile] = await Promise.all([
        this.api.venues(),
        this.isOwner ? this.api.profile() : Promise.resolve(null),
      ]);
      this.venues.set(venues.items);
      this.profile.set(profile);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load your venues.'));
    } finally {
      this.loading.set(false);
    }
  }
}
