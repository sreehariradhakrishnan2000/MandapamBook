import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL } from './legal-info';
import { LegalShell } from './legal-shell';

/**
 * Mirrors what the booking and payment code actually does (see docs/payments-migration.md):
 * owner declines and timeouts refund everything paid online; customer cancellations refund
 * the venue's policy share of the advance, never the platform fee; late payments refund in full.
 */
@Component({
  selector: 'app-refund-policy',
  imports: [LegalShell, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-legal-shell heading="Refund & Cancellation Policy">
      <h2>What you pay online</h2>
      <p>
        When you book, you pay two things online: an <strong>advance</strong> (a percentage of the
        booking set by the venue) and our <strong>platform fee</strong>. The rest of the booking
        amount is paid directly at the venue. The booking page shows each amount before you pay.
      </p>

      <h2>When you get a full refund automatically</h2>
      <p>You get back everything you paid online, including the platform fee, if:</p>
      <ul>
        <li>the venue declines your booking request;</li>
        <li>the venue does not answer your request within 24 hours;</li>
        <li>
          your payment went through after your hold on the date had expired, or the booking could
          not be completed for any other reason on our side.
        </li>
      </ul>
      <p>You do not need to ask: the refund starts by itself.</p>

      <h2>If the venue cannot host a confirmed booking</h2>
      <p>
        If a venue tells you it cannot host your confirmed booking, write to
        <a [href]="'mailto:' + L.supportEmail">{{ L.supportEmail }}</a> with your booking reference.
        Once we confirm it with the venue, we refund everything you paid online, including the
        platform fee.
      </p>

      <h2>If you cancel</h2>
      <p>
        You can cancel from <a routerLink="/account/bookings">My bookings</a>. The refund depends on
        how close the event is, following the cancellation policy of that venue, shown on the
        venue's page before you book. For example, a venue may refund 90% of the advance if you
        cancel 60 or more days before the event, 50% from 30 days, and 25% from 7 days.
      </p>
      <ul>
        <li>The refund is calculated on the advance you paid online.</li>
        <li>
          The <strong>platform fee is not refundable</strong> when you cancel, because the booking
          service has been provided.
        </li>
        <li>
          Anything you paid directly at the venue is refunded by the venue under its own terms.
        </li>
      </ul>

      <h2>How and when refunds reach you</h2>
      <ul>
        <li>Refunds go back to the card, UPI account or bank account you paid with.</li>
        <li>We start the refund as soon as it is due, through Razorpay.</li>
        <li>
          We use <strong>instant refunds</strong>: most UPI, card and net banking refunds reach your
          account <strong>within minutes</strong>.
        </li>
        <li>
          If your bank or payment method does not support instant refunds, the refund goes the
          standard way and can take <strong>5 to 7 working days</strong>.
        </li>
        <li>You receive an email when the refund is processed.</li>
      </ul>

      <h2>Changing a date</h2>
      <p>
        A booking cannot be moved to another date or slot. Cancel it under this policy and book the
        new date, or ask the venue directly.
      </p>

      <h2>Problems with a refund</h2>
      <p>
        If a refund has not arrived 2 working days after our refund email (7 working days if your
        bank does not support instant refunds), write to
        <a [href]="'mailto:' + L.supportEmail">{{ L.supportEmail }}</a> with your booking reference
        (for example MB-ABC234). We reply within 2 working days.
      </p>
    </app-legal-shell>
  `,
})
export class RefundPolicy {
  protected readonly L = LEGAL;
}
