import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SLOTS, type QuoteView, type Slot } from '@mandapambook/shared';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import {
  BookingApi,
  type HoldResponse,
  SLOT_LABELS,
  type VenuePage,
} from '../../core/booking-api.service';
import { InrPipe } from '../../shared/inr.pipe';
import { PaymentAdapter } from '../payments/payment-adapter';

/**
 * Booking flow: choose date, slot, guests and add-ons → see the server's price breakdown →
 * hold the slot (signed in, verified email) → countdown until payment (Phase 6).
 */
@Component({
  selector: 'app-book',
  imports: [FormsModule, RouterLink, InrPipe, PaymentAdapter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto flex max-w-2xl flex-col gap-5 py-4">
      @if (venue(); as v) {
        <a [routerLink]="['/venues', v.slug]" class="tap w-fit text-sm text-brand-700 underline"
          >← {{ v.name }}</a
        >
        <h1 class="font-display text-3xl font-medium">Book {{ hall()?.name }} at {{ v.name }}</h1>
      }

      @if (held(); as hold) {
        <div
          class="flex flex-col gap-3 rounded-2xl border border-brand-500 bg-brand-50 p-4"
          role="status"
        >
          <p class="font-semibold">Your date is on hold · reference {{ hold.refCode }}</p>
          @if (secondsLeft() > 0) {
            <p>
              Complete payment within
              <span class="font-mono text-lg font-bold tabular-nums">{{ countdown() }}</span> or the
              slot is released.
            </p>
            <app-payment-adapter [bookingId]="hold.id" [amountPaise]="hold.quote.payNowPaise" />
          } @else {
            <p>This hold has expired and the slot was released. You can try again.</p>
          }
          <div class="flex flex-wrap gap-3">
            <a
              routerLink="/account/bookings"
              class="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >My bookings</a
            >
            @if (secondsLeft() > 0) {
              <button
                type="button"
                class="rounded-full border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700"
                (click)="releaseHold()"
              >
                Cancel hold
              </button>
            }
          </div>
        </div>
      } @else {
        <form
          class="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4"
          (ngSubmit)="refresh()"
        >
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="flex flex-col gap-1 text-sm"
              >Date
              <input
                name="date"
                type="date"
                required
                [min]="today"
                class="rounded-xl border border-slate-300 px-2 py-2"
                [(ngModel)]="form.date"
                (change)="refresh()"
              />
            </label>
            <label class="flex flex-col gap-1 text-sm"
              >Slot
              <select
                name="slot"
                class="rounded-xl border border-slate-300 px-2 py-2"
                [(ngModel)]="form.slot"
                (ngModelChange)="refresh()"
              >
                @for (s of slots; track s) {
                  <option [value]="s">{{ slotLabels[s] }}</option>
                }
              </select>
            </label>
            <label class="flex flex-col gap-1 text-sm"
              >Guests
              <input
                name="guests"
                type="number"
                min="1"
                [max]="hall()?.seatingCapacity ?? 20000"
                class="rounded-xl border border-slate-300 px-2 py-2"
                [(ngModel)]="form.guests"
                (change)="refresh()"
              />
            </label>
          </div>
          @if (venue()?.addons?.length) {
            <fieldset class="flex flex-col gap-2 text-sm">
              <legend class="font-medium">Add-ons</legend>
              @for (a of venue()!.addons; track a.id) {
                <label class="flex flex-wrap items-center justify-between gap-2">
                  <span
                    >{{ a.name }} · {{ a.pricePaise | inr
                    }}{{ a.unit === 'PER_ROOM' ? ' per room' : '' }}</span
                  >
                  <input
                    type="number"
                    min="0"
                    [max]="a.maxQuantity"
                    class="w-20 rounded-xl border border-slate-300 px-2 py-1"
                    [name]="'addon-' + a.id"
                    [attr.aria-label]="'Quantity of ' + a.name"
                    [(ngModel)]="addonQty[a.id]"
                    (change)="refresh()"
                  />
                </label>
              }
            </fieldset>
          }
        </form>

        @if (auth.user(); as user) {
          @if (!user.emailVerified) {
            <section
              class="flex flex-col gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800"
              aria-labelledby="verify-heading"
            >
              <p id="verify-heading" class="font-semibold">Verify your email to book</p>
              <p>
                We sent a link to <span class="font-medium">{{ user.email }}</span>. Check your
                inbox and spam folder, then come back to this page.
              </p>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button
                  type="button"
                  class="tap font-semibold underline disabled:opacity-60"
                  [disabled]="verifyBusy()"
                  (click)="resendVerification()"
                >
                  {{ verifyBusy() ? 'Sending…' : 'Resend verification email' }}
                </button>
                <button
                  type="button"
                  class="tap underline disabled:opacity-60"
                  [disabled]="verifyBusy()"
                  (click)="checkVerified()"
                >
                  I've verified, check again
                </button>
              </div>
              @if (verifyMessage(); as m) {
                <p [class.text-red-700]="m.error" [class.text-forest-800]="!m.error" role="status">
                  {{ m.text }}
                </p>
              }
            </section>
          }
        }

        @if (error()) {
          <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {{ error() }}
          </p>
        }

        @if (quote(); as q) {
          <section
            class="rounded-2xl border border-slate-200 bg-white p-4"
            aria-labelledby="price-h"
          >
            <h2 id="price-h" class="font-semibold">Price breakdown</h2>
            <dl class="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
              <dt>{{ slotLabels[q.slot] }} ({{ ruleLabel(q.ruleKind) }})</dt>
              <dd class="text-right">{{ q.basePaise | inr }}</dd>
              @for (a of q.addons; track a.addonId) {
                <dt>{{ a.name }} × {{ a.quantity }}</dt>
                <dd class="text-right">{{ a.totalPaise | inr }}</dd>
              }
              <dt>GST ({{ q.gstBasisPoints / 100 }}%)</dt>
              <dd class="text-right">{{ q.gstPaise | inr }}</dd>
              <dt>Platform fee</dt>
              <dd class="text-right">{{ q.platformFeePaise | inr }}</dd>
              <dt class="border-t border-slate-200 pt-1 font-semibold">Total</dt>
              <dd class="border-t border-slate-200 pt-1 text-right font-semibold">
                {{ q.totalPaise | inr }}
              </dd>
              <dt class="pt-2 font-semibold text-brand-700">
                Pay now ({{ q.advancePercent }}% advance + fee)
              </dt>
              <dd class="pt-2 text-right font-semibold text-brand-700">
                {{ q.payNowPaise | inr }}
              </dd>
              <dt class="text-slate-600">Pay at the venue</dt>
              <dd class="text-right text-slate-600">{{ q.payLaterPaise | inr }}</dd>
            </dl>
            @if (!q.available) {
              <p class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                This slot is already booked. Choose another date or slot.
              </p>
            } @else {
              <button
                type="button"
                class="mt-4 w-full rounded-full bg-brand-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
                [disabled]="busy()"
                (click)="hold()"
              >
                {{ auth.isSignedIn() ? 'Hold this date' : 'Sign in to hold this date' }}
              </button>
            }
          </section>
        }
      }
    </section>
  `,
})
export class Book implements OnInit {
  private readonly api = inject(BookingApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  readonly hallId = input.required<string>();
  readonly slug = input<string>();
  readonly date = input<string>();
  readonly slot = input<Slot>();
  readonly guests = input<string>();

  protected readonly slots = SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(),
  );
  protected readonly venue = signal<VenuePage | null>(null);
  protected readonly hall = computed(
    () => this.venue()?.halls.find((h) => h.id === this.hallId()) ?? null,
  );
  protected readonly quote = signal<QuoteView | null>(null);
  protected readonly held = signal<HoldResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly now = signal(Date.now());
  protected readonly secondsLeft = computed(() => {
    const h = this.held();
    return h
      ? Math.max(0, Math.round((new Date(h.holdExpiresAt).getTime() - this.now()) / 1000))
      : 0;
  });
  protected readonly countdown = computed(() => {
    const s = this.secondsLeft();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  protected form = { date: '', slot: 'MORNING' as Slot, guests: 100 };
  protected addonQty: Record<string, number> = {};

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async ngOnInit(): Promise<void> {
    this.form = {
      date: this.date() ?? '',
      slot: this.slot() ?? 'MORNING',
      guests: this.guests() ? Number(this.guests()) : 100,
    };
    const slug = this.slug();
    if (slug) {
      try {
        this.venue.set(await this.api.venue(slug));
      } catch (err) {
        this.error.set(errorMessage(err, 'Could not load the venue.'));
      }
    }
    if (this.form.date) await this.refresh();
  }

  protected ruleLabel(kind: string): string {
    return (
      {
        BASE: 'standard',
        WEEKEND: 'weekend',
        MUHURTHAM: 'muhurtham day',
        SEASONAL: 'seasonal',
        DATE_OVERRIDE: 'special date',
      }[kind] ?? kind
    );
  }

  private request() {
    return {
      hallId: this.hallId(),
      eventDate: this.form.date,
      slot: this.form.slot,
      guestCount: Number(this.form.guests),
      addons: Object.entries(this.addonQty)
        .filter(([, q]) => Number(q) > 0)
        .map(([addonId, quantity]) => ({ addonId, quantity: Number(quantity) })),
    };
  }

  protected async refresh(): Promise<void> {
    if (!this.form.date || !this.form.guests) return;
    this.error.set(null);
    try {
      this.quote.set(await this.api.quote(this.request()));
    } catch (err) {
      this.quote.set(null);
      this.error.set(errorMessage(err));
    }
  }

  protected async hold(): Promise<void> {
    if (!this.auth.isSignedIn()) {
      await this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    if (this.auth.user()?.emailVerified === false) {
      // The notice above has the resend button; say so instead of a server error.
      this.verifyMessage.set({
        text: 'Verify your email first, using the link we sent or the button above.',
        error: true,
      });
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      this.held.set(await this.api.hold(this.request()));
    } catch (err) {
      this.error.set(errorMessage(err));
      if (err instanceof HttpErrorResponse && err.error?.error?.code === 'SLOT_UNAVAILABLE')
        await this.refresh();
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly verifyBusy = signal(false);
  protected readonly verifyMessage = signal<{ text: string; error: boolean } | null>(null);

  /** Sends a fresh verification link without leaving the booking page. */
  protected async resendVerification(): Promise<void> {
    this.verifyBusy.set(true);
    try {
      await this.auth.resendVerificationEmail();
      this.verifyMessage.set({
        text: 'Sent. Open the newest email from MandapamBook; earlier links no longer work.',
        error: false,
      });
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409) {
        await this.checkVerified();
        return;
      }
      this.verifyMessage.set({
        text: errorMessage(err, 'Could not send the email. Try again in a few minutes.'),
        error: true,
      });
    } finally {
      this.verifyBusy.set(false);
    }
  }

  /** After the link was opened (maybe in another tab), reloads the account to pick it up. */
  protected async checkVerified(): Promise<void> {
    this.verifyBusy.set(true);
    try {
      await this.auth.refresh();
      if (this.auth.user()?.emailVerified) {
        this.verifyMessage.set(null);
        if (this.error()?.startsWith('Verify your email')) this.error.set(null);
      } else {
        this.verifyMessage.set({
          text: 'Not verified yet. Open the link in the email, then try again.',
          error: true,
        });
      }
    } finally {
      this.verifyBusy.set(false);
    }
  }

  protected async releaseHold(): Promise<void> {
    const h = this.held();
    if (!h) return;
    try {
      await this.api.cancel(h.id, 'Released by customer');
      this.held.set(null);
      await this.refresh();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
