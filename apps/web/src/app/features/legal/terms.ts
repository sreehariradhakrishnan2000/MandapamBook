import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL } from './legal-info';
import { LegalShell } from './legal-shell';

@Component({
  selector: 'app-terms',
  imports: [LegalShell, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-legal-shell heading="Terms of Use">
      <h2>1. About MandapamBook</h2>
      <p>
        MandapamBook ({{ L.website }}) is an online marketplace where customers find and book
        kalyana mandapams, convention halls and auditoriums for weddings and other events. It is
        operated by {{ L.operatorDescription }} ("we", "us"). These Terms of Use apply to everyone
        who uses the website: visitors, customers who book, and venue owners who list their halls.
        By creating an account or making a booking you agree to them.
      </p>
      <p>
        The venues on MandapamBook are owned and run by independent venue owners. We provide the
        listing, booking and online payment service; the venue owner provides the hall and the event
        services, and is responsible for them.
      </p>

      <h2>2. Who can use MandapamBook</h2>
      <ul>
        <li>You must be at least 18 years old and able to enter into a binding contract.</li>
        <li>
          The details you give us (name, email address, mobile number) must be true and your own.
          You must verify your email address before booking.
        </li>
        <li>
          Keep your password secret. You are responsible for activity on your account; tell us at
          once at <a [href]="'mailto:' + L.supportEmail">{{ L.supportEmail }}</a> if you think
          someone else has used it.
        </li>
      </ul>

      <h2>3. Prices</h2>
      <p>
        Every venue sets its own prices. Before you pay, the booking page shows the full price
        breakdown: the hall rent and any add-ons, GST, our platform fee, the total, the amount
        payable online now (the advance plus the platform fee) and the balance payable at the venue.
        The price shown when you pay is the price of your booking; later price changes do not affect
        it.
      </p>

      <h2>4. Booking and payment</h2>
      <ul>
        <li>
          When you choose a date and slot, we hold it for you for a few minutes while you pay. If
          payment is not completed in time, the hold ends and the date becomes available to others.
        </li>
        <li>
          Online payments are processed by Razorpay, a licensed payment aggregator. We never see or
          store your card or bank login details.
        </li>
        <li>
          <strong>Instant-book venues</strong> confirm your booking as soon as the payment succeeds.
          <strong>Other venues</strong> confirm each request themselves: they have 24 hours to
          accept or decline, and if they decline or do not answer, you get a full refund
          automatically.
        </li>
        <li>
          The balance is paid directly to the venue, as the venue tells you. It is a matter between
          you and the venue owner.
        </li>
        <li>
          After payment you receive a confirmation and a GST invoice by email. There is nothing to
          ship: the service is delivered at the venue on your event date.
        </li>
      </ul>

      <h2>5. Cancellations and refunds</h2>
      <p>
        Cancellations and refunds follow our
        <a routerLink="/refund-policy">Refund &amp; Cancellation Policy</a> and the cancellation
        policy shown on each venue's page, which you can read before you book.
      </p>

      <h2>6. Reviews</h2>
      <p>
        Only customers who booked a venue can review it. Reviews must be honest, about your own
        experience, and free of abusive, defamatory or misleading content. We may hide reviews that
        break these rules. Venue owners may reply publicly.
      </p>

      <h2>7. Venue owners</h2>
      <ul>
        <li>
          Owners must give accurate details about their venue (capacity, facilities, photos, prices,
          policies), hold every licence and permission the venue needs, and keep it safe for guests.
        </li>
        <li>
          Owners complete identity and payout verification (KYC) before their venue goes live. We
          review listings, but we do not guarantee every detail an owner provides.
        </li>
        <li>
          A confirmed booking must be honoured. If an owner cancels one, the customer gets a full
          refund and we may suspend the listing.
        </li>
        <li>
          We pay owners the advance collected online, less our commission and applicable taxes, on
          the schedule agreed with them.
        </li>
      </ul>

      <h2>8. What you must not do</h2>
      <ul>
        <li>Use MandapamBook for anything unlawful, fraudulent or harmful.</li>
        <li>Book dates you do not intend to use, or hold dates to block others.</li>
        <li>Upload content you do not have the right to use, or anything offensive.</li>
        <li>Try to break, overload, copy or scrape the website, or get around its security.</li>
      </ul>

      <h2>9. Our responsibility</h2>
      <p>
        We work hard to keep MandapamBook accurate and available, but we cannot promise it will
        always be free of errors or interruptions. We are not responsible for the services a venue
        provides at your event; those are the venue owner's responsibility. To the extent the law
        allows, our total liability for any claim about a booking is limited to the amount you paid
        us online for that booking. Nothing in these terms limits rights you have under the Consumer
        Protection Act, 2019.
      </p>
      <p>
        We are not liable for delays or failures caused by events beyond our reasonable control,
        such as natural disasters, government orders or outages of networks and payment systems.
      </p>

      <h2>10. Our content</h2>
      <p>
        The MandapamBook name, logo, design and software belong to us. Venue photos and descriptions
        belong to the venue owners who provide them and are used with their permission.
      </p>

      <h2>11. Suspension and closing accounts</h2>
      <p>
        You can stop using MandapamBook at any time. We may suspend or close accounts that break
        these terms or are used for fraud. Bookings already confirmed are handled under the Refund
        &amp; Cancellation Policy.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We may update these terms. The date at the top shows the latest version. Changes apply to
        bookings made after they are published.
      </p>

      <h2>13. Law and disputes</h2>
      <p>
        These terms are governed by the laws of India. Courts at {{ L.jurisdiction }} have
        jurisdiction over any dispute, without affecting your right to approach a consumer
        commission.
      </p>

      <h2>14. Questions and grievances</h2>
      <p>
        Write to <a [href]="'mailto:' + L.supportEmail">{{ L.supportEmail }}</a>. See
        <a routerLink="/contact">Contact us</a> for our Grievance Officer.
      </p>
    </app-legal-shell>
  `,
})
export class Terms {
  protected readonly L = LEGAL;
}
