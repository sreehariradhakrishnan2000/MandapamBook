import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import {
  type BookingDetail,
  type BookingSummary,
  BookingApi,
  type RefundPreview,
  SLOT_LABELS,
  STATUS_LABELS,
} from '../../core/booking-api.service';
import { API } from '../../core/auth/auth.service';
import { FileDownload } from '../../core/file-download';
import { InsightsApi } from '../../core/insights-api.service';
import { InrPipe } from '../../shared/inr.pipe';
import { OfflineReviews } from './offline-reviews';

const CANCELLABLE = new Set(['HELD', 'PENDING_PAYMENT', 'AWAITING_OWNER', 'CONFIRMED']);
const INVOICEABLE = new Set(['AWAITING_OWNER', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDED']);

@Component({
  selector: 'app-my-bookings',
  imports: [DatePipe, RouterLink, InrPipe, OfflineReviews],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <h1 class="font-display text-3xl font-medium">My bookings</h1>
      <ul class="flex flex-col gap-3">
        @for (b of items(); track b.id) {
          <li>
            <a
              [routerLink]="b.id"
              class="flex flex-wrap items-center justify-between gap-2 rounded-full border border-slate-200 bg-white p-4 hover:border-brand-500"
            >
              <span class="min-w-0">
                <span class="block font-semibold">{{ b.venueName }} · {{ b.hallName }}</span>
                <span class="block text-sm text-slate-600"
                  >{{ b.eventDate | date: 'EEE, d MMM y' }} · {{ slotLabels[b.slot] }} ·
                  {{ b.city }}</span
                >
              </span>
              <span class="text-right text-sm">
                <span class="block font-semibold">{{ statusLabels[b.status] }}</span>
                <span class="block tabular-nums text-slate-600"
                  >{{ b.totalPaise | inr }} · {{ b.refCode }}</span
                >
              </span>
            </a>
          </li>
        } @empty {
          @if (!loading()) {
            <li class="rounded-2xl border border-dashed border-slate-300 p-6 text-slate-600">
              No bookings yet.
              <a routerLink="/" class="font-semibold text-brand-700 underline">Find a hall</a>
            </li>
          }
        }
      </ul>
      <app-offline-reviews class="mt-6" />
    </section>
  `,
})
export class MyBookings implements OnInit {
  private readonly api = inject(BookingApi);
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly items = signal<BookingSummary[]>([]);
  protected readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      this.items.set((await this.api.mine()).items);
    } finally {
      this.loading.set(false);
    }
  }
}

@Component({
  selector: 'app-booking-detail',
  imports: [DatePipe, FormsModule, RouterLink, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto flex max-w-2xl flex-col gap-4 py-4">
      <a routerLink="/account/bookings" class="tap w-fit text-sm text-brand-700 underline"
        >← My bookings</a
      >
      @if (b(); as b) {
        <header>
          <h1 class="font-display text-3xl font-medium">{{ b.venueName }} · {{ b.hallName }}</h1>
          <p class="text-slate-600">
            {{ b.eventDate | date: 'EEEE, d MMMM y' }} · {{ slotLabels[b.slot] }} ·
            {{ b.guestCount }} guests
          </p>
          <p class="mt-1 text-sm">
            Reference <span class="font-mono font-semibold">{{ b.refCode }}</span> ·
            <span class="font-semibold">{{ statusLabels[b.status] }}</span>
          </p>
          <p class="text-sm text-slate-600">{{ b.addressLine }}, {{ b.city }} {{ b.pincode }}</p>
        </header>

        <dl
          class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-2xl border border-slate-200 bg-white p-4 text-sm tabular-nums"
        >
          <dt>Hall</dt>
          <dd class="text-right">{{ b.subtotalPaise | inr }}</dd>
          @if (b.addonsPaise) {
            <dt>Add-ons</dt>
            <dd class="text-right">{{ b.addonsPaise | inr }}</dd>
          }
          <dt>GST</dt>
          <dd class="text-right">{{ b.gstPaise | inr }}</dd>
          <dt>Platform fee</dt>
          <dd class="text-right">{{ b.platformFeePaise | inr }}</dd>
          <dt class="font-semibold">Total</dt>
          <dd class="text-right font-semibold">{{ b.totalPaise | inr }}</dd>
          <dt>Online advance</dt>
          <dd class="text-right">{{ b.advancePaise | inr }}</dd>
          @if (b.refundDuePaise) {
            <dt class="text-leaf-600">Refund due</dt>
            <dd class="text-right text-leaf-600">{{ b.refundDuePaise | inr }}</dd>
          }
        </dl>

        @if (invoiceable()) {
          <button
            type="button"
            class="w-fit rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium"
            [disabled]="downloading()"
            (click)="downloadInvoice()"
          >
            {{ downloading() ? 'Preparing invoice…' : 'Download invoice (PDF)' }}
          </button>
        }

        @if (b.status === 'COMPLETED') {
          <section
            class="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm"
            aria-labelledby="review-h"
          >
            <h2 id="review-h" class="font-semibold">Your review</h2>
            @if (b.review; as r) {
              <p>
                Thank you. You rated this venue
                <span class="font-semibold">{{ r.rating }} out of 5</span>.
              </p>
            } @else if (
              !auth.user()?.fullName?.trim() || !(auth.user()?.email || auth.user()?.phone)
            ) {
              <p>
                To keep reviews genuine, your account needs your name and an email address or mobile
                number before you write one.
                <a routerLink="/account" class="font-semibold text-brand-700 underline"
                  >Update your account</a
                >
              </p>
            } @else {
              <fieldset class="flex flex-col gap-1">
                <legend class="mb-1">How was the venue?</legend>
                <div class="flex gap-1" role="radiogroup" aria-label="Rating out of 5">
                  @for (n of stars; track n) {
                    <button
                      type="button"
                      role="radio"
                      class="rounded px-1 text-2xl leading-none"
                      [class.text-amber-500]="n <= rating()"
                      [class.text-slate-300]="n > rating()"
                      [attr.aria-checked]="n === rating()"
                      [attr.aria-label]="n + (n === 1 ? ' star' : ' stars')"
                      (click)="rating.set(n)"
                    >
                      ★
                    </button>
                  }
                </div>
              </fieldset>
              <label class="flex flex-col gap-1"
                >What should other families know? (optional)
                <textarea
                  class="rounded-xl border border-slate-300 px-2 py-1.5"
                  rows="3"
                  maxlength="2000"
                  [(ngModel)]="reviewBody"
                ></textarea>
              </label>
              <button
                type="button"
                class="w-fit rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                [disabled]="rating() === 0 || submitting()"
                (click)="submitReview()"
              >
                Post review
              </button>
            }
          </section>
        }

        @if (cancellable()) {
          <section
            class="flex flex-col gap-2 rounded-2xl border border-red-200 bg-white p-4 text-sm"
            aria-labelledby="cancel-h"
          >
            <h2 id="cancel-h" class="font-semibold">Cancel this booking</h2>
            @if (preview(); as p) {
              <p>
                {{ p.rule }}. You would get back
                <span class="font-semibold tabular-nums">{{ p.refundPaise | inr }}</span>.
              </p>
            }
            @if (confirming()) {
              <label class="flex flex-col gap-1"
                >Reason (optional)<input
                  class="rounded-xl border border-slate-300 px-2 py-1.5"
                  [(ngModel)]="reason"
              /></label>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="rounded-full bg-red-700 px-3 py-1.5 font-semibold text-white"
                  (click)="cancel()"
                >
                  Yes, cancel
                </button>
                <button
                  type="button"
                  class="rounded-full border border-slate-300 px-3 py-1.5"
                  (click)="confirming.set(false)"
                >
                  Keep booking
                </button>
              </div>
            } @else {
              <button
                type="button"
                class="w-fit rounded-full border border-red-300 px-3 py-1.5 text-red-700"
                (click)="startCancel()"
              >
                Cancel booking
              </button>
            }
          </section>
        }
        @if (error()) {
          <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {{ error() }}
          </p>
        }

        <section aria-labelledby="hist-h">
          <h2 id="hist-h" class="font-semibold">History</h2>
          <ol class="mt-1 text-sm text-slate-600">
            @for (hst of b.history; track $index) {
              <li>{{ hst.at | date: 'd MMM y, h:mm a' }} · {{ statusLabels[hst.toStatus] }}</li>
            }
          </ol>
        </section>
      }
    </section>
  `,
})
export class BookingDetailPage implements OnInit {
  private readonly api = inject(BookingApi);
  private readonly insights = inject(InsightsApi);
  private readonly files = inject(FileDownload);
  protected readonly auth = inject(AuthService);
  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly rating = signal(0);
  protected readonly submitting = signal(false);
  protected readonly downloading = signal(false);
  protected readonly invoiceable = signal(false);
  protected reviewBody = '';
  readonly id = input.required<string>();
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly b = signal<BookingDetail | null>(null);
  protected readonly preview = signal<RefundPreview | null>(null);
  protected readonly confirming = signal(false);
  protected readonly cancellable = signal(false);
  protected readonly error = signal<string | null>(null);
  protected reason = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    const b = await this.api.booking(this.id());
    this.b.set(b);
    this.cancellable.set(CANCELLABLE.has(b.status));
    this.invoiceable.set(INVOICEABLE.has(b.status));
  }

  protected async downloadInvoice(): Promise<void> {
    this.downloading.set(true);
    this.error.set(null);
    try {
      await this.files.download(`${API}/bookings/${this.id()}/invoice.pdf`, 'invoice.pdf');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.downloading.set(false);
    }
  }

  protected async submitReview(): Promise<void> {
    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.insights.createReview(this.id(), this.rating(), this.reviewBody.trim());
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async startCancel(): Promise<void> {
    this.error.set(null);
    try {
      this.preview.set(await this.api.cancelPreview(this.id()));
      this.confirming.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async cancel(): Promise<void> {
    try {
      await this.api.cancel(this.id(), this.reason.trim() || undefined);
      this.confirming.set(false);
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
