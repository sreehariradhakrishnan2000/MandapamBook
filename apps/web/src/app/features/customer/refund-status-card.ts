import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RefundStatus } from '../../core/booking-api.service';
import { InrPipe } from '../../shared/inr.pipe';
import { LEGAL } from '../legal/legal-info';

/**
 * Where the customer's money is, in plain words: on its way (with the steps so far and what
 * to expect), completed (when, and a reference the bank can trace), or, for a paid booking
 * cancelled too close to the event, that no refund was due and why.
 */
@Component({
  selector: 'app-refund-status-card',
  imports: [DatePipe, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (refund(); as r) {
      <section
        class="flex flex-col gap-3 rounded-2xl border p-4 text-sm"
        [class]="
          r.status === 'COMPLETED'
            ? 'border-forest-200 bg-forest-50'
            : 'border-marigold-300 bg-marigold-100/60'
        "
        aria-labelledby="refund-h"
      >
        @if (r.status === 'COMPLETED') {
          <h2 id="refund-h" class="flex items-center gap-2 text-base font-semibold text-forest-800">
            <span aria-hidden="true">✓</span> Refund completed
          </h2>
          <p>
            <strong class="tabular-nums">{{ r.amountPaise | inr }}</strong> was sent back to the
            card, UPI or bank account you paid with on
            <strong>{{ r.completedAt | date: 'd MMMM y' }}</strong>. Depending on your bank, it can
            take a few working days to show on your statement.
          </p>
        } @else {
          <h2 id="refund-h" class="flex items-center gap-2 text-base font-semibold text-slate-900">
            <span aria-hidden="true">↻</span> Your refund is on its way
          </h2>
          <p>
            <strong class="tabular-nums">{{ r.amountPaise | inr }}</strong> is being returned to the
            card, UPI or bank account you paid with. We will email you as soon as it is complete.
          </p>
        }

        <ol class="flex flex-col gap-1.5" aria-label="Refund progress">
          <li class="flex gap-2">
            <span class="text-forest-700" aria-hidden="true">●</span>
            <span
              >Booking cancelled
              @if (cancelledAt(); as c) {
                <span class="text-slate-600">· {{ c | date: 'd MMM y' }}</span>
              }
            </span>
          </li>
          <li class="flex gap-2">
            <span class="text-forest-700" aria-hidden="true">●</span>
            <span
              >Refund started
              <span class="text-slate-600">· {{ r.startedAt | date: 'd MMM y' }}</span></span
            >
          </li>
          <li class="flex gap-2">
            @if (r.status === 'COMPLETED') {
              <span class="text-forest-700" aria-hidden="true">●</span>
              <span
                >Refund completed
                <span class="text-slate-600">· {{ r.completedAt | date: 'd MMM y' }}</span></span
              >
            } @else {
              <span class="text-slate-400" aria-hidden="true">○</span>
              <span
                >Money back in your account
                <span class="text-slate-600">· usually within 5–7 working days</span></span
              >
            }
          </li>
        </ol>

        <p class="text-xs text-slate-600">
          @if (r.reference) {
            Refund reference <span class="font-mono">{{ r.reference }}</span> ·
          }
          Booking <span class="font-mono">{{ refCode() }}</span>
        </p>
        <p class="text-xs text-slate-600">
          @if (r.status === 'COMPLETED') {
            Can't see it after 7 working days? Write to
          } @else {
            Questions about your refund? Write to
          }
          <a [href]="'mailto:' + supportEmail" class="text-brand-700 underline">{{
            supportEmail
          }}</a>
          with your booking reference. We reply within 2 working days and can trace it with the bank
          for you.
        </p>
      </section>
    } @else if (noRefund()) {
      <section
        class="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm"
        aria-labelledby="refund-h"
      >
        <h2 id="refund-h" class="text-base font-semibold">No refund for this cancellation</h2>
        <p>
          This booking was cancelled
          {{ daysBefore() === 0 ? 'on the day of' : daysBefore() + ' days before' }} the event.
          Under the venue's cancellation policy, which was shown before payment, no part of the
          advance is refunded at that point. The platform fee is not refundable.
        </p>
        <p class="text-xs text-slate-600">
          Think this is wrong? Write to
          <a [href]="'mailto:' + supportEmail" class="text-brand-700 underline">{{
            supportEmail
          }}</a>
          with booking reference <span class="font-mono">{{ refCode() }}</span>.
        </p>
      </section>
    }
  `,
})
export class RefundStatusCard {
  readonly refund = input<RefundStatus | null>(null);
  readonly refCode = input.required<string>();
  readonly cancelledAt = input<string | null>(null);
  readonly eventDate = input.required<string>();
  /** True when the booking was cancelled after being paid (so a refund could apply). */
  readonly paidAndCancelled = input(false);

  protected readonly supportEmail = LEGAL.supportEmail;
  protected readonly noRefund = computed(
    () => this.paidAndCancelled() && !this.refund() && this.cancelledAt() !== null,
  );
  protected readonly daysBefore = computed(() => {
    const cancelled = this.cancelledAt();
    if (!cancelled) return 0;
    const ist = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
      new Date(cancelled),
    );
    const utc = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
    return Math.max(0, Math.round((utc(this.eventDate()) - utc(ist)) / 86_400_000));
  });
}
