import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type RefundTier, describeRefundTiers } from '@mandapambook/shared';
import { InrPipe } from '../../shared/inr.pipe';

/** Whole days from today (IST) to an event date (YYYY-MM-DD). */
export function daysUntil(eventDate: string, today: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(eventDate) - utc(today)) / 86_400_000);
}

/**
 * The short cancellation and refund summary shown right above the Pay button, with the
 * required "I agree" tick. The API refuses the payment order without that tick and records
 * the acceptance (with this booking's refund tiers) in the audit log.
 */
@Component({
  selector: 'app-before-you-pay',
  imports: [RouterLink, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800"
      aria-labelledby="before-pay-h"
    >
      <h2 id="before-pay-h" class="font-semibold">Before you pay: cancellation and refunds</h2>
      <p>If you cancel this booking, this venue refunds the advance as follows:</p>
      <ul class="list-disc pl-5">
        @for (line of tierLines(); track line) {
          <li>{{ line }}</li>
        }
      </ul>
      <ul class="list-disc pl-5">
        <li>
          The platform fee ({{ platformFeePaise() | inr }}) is <strong>not refundable</strong> when
          you cancel.
        </li>
        <li>
          If the venue declines or does not reply within 24 hours, you get back everything you paid
          online.
        </li>
        <li>The date cannot be changed later; you would cancel and book again.</li>
      </ul>
      @if (days() >= 0) {
        <p class="font-medium">
          Your event is
          {{ days() === 0 ? 'today' : 'in ' + days() + (days() === 1 ? ' day' : ' days') }}:
          @if (refundNow() > 0) {
            cancelling today would refund {{ refundNow() }}% of the advance.
          } @else {
            cancelling now would give <strong>no refund</strong>.
          }
        </p>
      }
      <label class="mt-1 flex items-start gap-2">
        <input
          type="checkbox"
          class="mt-0.5 size-4 shrink-0 accent-brand-600"
          [checked]="agreed()"
          (change)="agreed.set($any($event.target).checked)"
        />
        <span
          >I have read and agree to these cancellation terms, the
          <a routerLink="/terms" target="_blank" class="text-brand-700 underline">Terms of Use</a>
          and the
          <a routerLink="/refund-policy" target="_blank" class="text-brand-700 underline"
            >Refund &amp; Cancellation Policy</a
          >.</span
        >
      </label>
    </section>
  `,
})
export class BeforeYouPay {
  readonly tiers = input.required<readonly RefundTier[]>();
  readonly eventDate = input.required<string>();
  readonly platformFeePaise = input.required<number>();
  /** Two-way: the parent passes it to the payment button. */
  readonly agreed = model(false);

  private readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(),
  );
  protected readonly tierLines = computed(() => describeRefundTiers(this.tiers()));
  protected readonly days = computed(() => daysUntil(this.eventDate(), this.today));
  protected readonly refundNow = computed(() => {
    const sorted = [...this.tiers()].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
    return sorted.find((t) => this.days() >= t.minDaysBefore)?.refundPercent ?? 0;
  });
}
