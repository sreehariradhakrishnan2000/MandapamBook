import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ReviewableOfflineBooking } from '@mandapambook/shared';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { InsightsApi } from '../../core/insights-api.service';

/**
 * Events a venue booked for this person by phone or in person. They're found through the
 * account's verified mobile number, which the venue recorded, and can be reviewed after.
 */
@Component({
  selector: 'app-offline-reviews',
  imports: [DatePipe, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="offline-reviews-h" class="flex flex-col gap-3">
      <h2 id="offline-reviews-h" class="font-display text-xl font-medium">
        Booked directly with a venue
      </h2>
      @if (!canMatch()) {
        <p class="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          Booked a hall by phone or in person? Verify your email address or mobile number, and the
          events a venue recorded for them appear here, so you can review them.
          <a routerLink="/account" class="font-semibold text-brand-700 underline">Your account</a>
        </p>
      } @else {
        @if (error()) {
          <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {{ error() }}
          </p>
        }
        <ul class="flex flex-col gap-3">
          @for (b of items(); track b.offlineBookingId) {
            <li
              class="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm"
            >
              <p>
                <a [routerLink]="['/venues', b.venueSlug]" class="font-semibold underline">{{
                  b.venueName
                }}</a>
                · {{ b.hallName }}
                @if (b.eventType) {
                  · {{ b.eventType }}
                }
              </p>
              <p class="text-slate-600">
                {{ b.firstDate | date: 'EEE, d MMM y' }}
                @if (b.lastDate !== b.firstDate) {
                  – {{ b.lastDate | date: 'EEE, d MMM y' }}
                }
              </p>
              @if (b.review; as r) {
                <p>
                  Thank you. You rated this venue
                  <span class="font-semibold">{{ r.rating }} out of 5</span>.
                </p>
              } @else if (!b.canReview) {
                <p class="text-slate-600">You can review this venue after the event.</p>
              } @else {
                <div
                  class="flex gap-1"
                  role="radiogroup"
                  [attr.aria-label]="'Rating for ' + b.venueName"
                >
                  @for (n of stars; track n) {
                    <button
                      type="button"
                      role="radio"
                      class="rounded px-1 text-2xl leading-none"
                      [class.text-amber-500]="n <= (ratings()[b.offlineBookingId] ?? 0)"
                      [class.text-slate-300]="n > (ratings()[b.offlineBookingId] ?? 0)"
                      [attr.aria-checked]="n === ratings()[b.offlineBookingId]"
                      [attr.aria-label]="n + (n === 1 ? ' star' : ' stars')"
                      (click)="rate(b.offlineBookingId, n)"
                    >
                      ★
                    </button>
                  }
                </div>
                <label class="flex flex-col gap-1"
                  >What should other families know? (optional)
                  <textarea
                    class="rounded-xl border border-slate-300 px-2 py-1.5"
                    rows="3"
                    maxlength="2000"
                    [ngModel]="bodies[b.offlineBookingId] ?? ''"
                    (ngModelChange)="bodies[b.offlineBookingId] = $event"
                  ></textarea>
                </label>
                <button
                  type="button"
                  class="w-fit rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                  [disabled]="!ratings()[b.offlineBookingId] || busy()"
                  (click)="submit(b)"
                >
                  Post review
                </button>
              }
            </li>
          } @empty {
            @if (!loading()) {
              <li
                class="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-600"
              >
                No bookings recorded by venues for your email or mobile number yet. Venues record
                these when you book with them directly.
              </li>
            }
          }
        </ul>
      }
    </section>
  `,
})
export class OfflineReviews implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(InsightsApi);
  protected readonly stars = [1, 2, 3, 4, 5];
  /** Venues' records are matched on a verified email or a verified mobile number. */
  protected readonly canMatch = computed(
    () => !!(this.auth.user()?.emailVerified || this.auth.user()?.phoneVerified),
  );
  protected readonly items = signal<ReviewableOfflineBooking[]>([]);
  protected readonly ratings = signal<Record<string, number>>({});
  protected bodies: Record<string, string> = {};
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (this.canMatch()) await this.load();
    this.loading.set(false);
  }

  private async load(): Promise<void> {
    try {
      this.items.set((await this.api.myOfflineBookings()).items);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load these bookings.'));
    }
  }

  protected rate(id: string, n: number): void {
    this.ratings.update((r) => ({ ...r, [id]: n }));
  }

  protected async submit(b: ReviewableOfflineBooking): Promise<void> {
    const rating = this.ratings()[b.offlineBookingId];
    if (!rating) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.reviewOfflineBooking(
        b.offlineBookingId,
        rating,
        (this.bodies[b.offlineBookingId] ?? '').trim(),
      );
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not post the review.'));
    } finally {
      this.busy.set(false);
    }
  }
}
