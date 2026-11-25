import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL } from './legal-info';
import { LegalShell } from './legal-shell';

@Component({
  selector: 'app-privacy',
  imports: [LegalShell, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-legal-shell heading="Privacy Policy">
      <p>
        This policy explains what personal data MandapamBook ({{ L.website }}), operated by
        {{ L.operatorDescription }}, collects, why, and the choices you have. It follows the Digital
        Personal Data Protection Act, 2023 and the Information Technology Act, 2000 and its rules.
      </p>

      <h2>1. What we collect</h2>
      <h3>When you create an account</h3>
      <ul>
        <li>Your name, email address and, if you add it, your mobile number.</li>
        <li>Your password, stored only as a one-way hash that cannot be turned back into it.</li>
        <li>If you sign in with Google, your Google name and email address.</li>
      </ul>
      <h3>When you book</h3>
      <ul>
        <li>The venue, hall, date, slot, guest count and add-ons you choose.</li>
        <li>
          Payment details such as the amount, status and Razorpay's payment reference. Your card,
          UPI or bank login details go directly to Razorpay; we never see or store them.
        </li>
        <li>Reviews you write.</li>
      </ul>
      <h3>From venue owners</h3>
      <ul>
        <li>
          Business name, PAN and bank account details for payouts. PAN and account numbers are
          encrypted.
        </li>
        <li>Venue details, photos and prices.</li>
      </ul>
      <h3>Automatically</h3>
      <ul>
        <li>
          Your IP address, browser and device type, and the pages you use, recorded in security and
          activity logs.
        </li>
        <li>
          Your location only if you choose "Use my current location", only to find halls near you.
          We do not store it.
        </li>
      </ul>

      <h2>2. Why we use it</h2>
      <ul>
        <li>
          To create and secure your account, and to verify your email address and mobile number.
        </li>
        <li>To make bookings, take payments, issue invoices and process refunds.</li>
        <li>To send booking confirmations, updates, receipts and security alerts.</li>
        <li>To let venue owners fulfil your booking.</li>
        <li>
          To prevent fraud and abuse, and to keep records the law requires (for example for GST).
        </li>
      </ul>
      <p>
        We use your data with your consent and to perform the bookings you ask for. We do not sell
        it, and we do not send advertising emails without your permission.
      </p>

      <h2>3. Who we share it with</h2>
      <ul>
        <li>
          <strong>The venue you book:</strong> your name, contact details and booking details, so
          they can host your event.
        </li>
        <li><strong>Razorpay:</strong> to process payments and refunds.</li>
        <li><strong>Brevo:</strong> to deliver our emails.</li>
        <li>
          <strong>Hosting providers:</strong> our servers and database run with Render and Neon.
          Some of these services store data outside India, under their security and contractual
          safeguards.
        </li>
        <li>
          <strong>Authorities:</strong> when the law requires it, or to protect people from fraud or
          harm.
        </li>
      </ul>

      <h2>4. Cookies</h2>
      <p>
        We use only cookies needed for the site to work: to keep you signed in and to protect forms
        from forgery. We do not use advertising or tracking cookies.
      </p>

      <h2>5. How long we keep it</h2>
      <p>
        We keep your account data while your account is open. Booking, payment and invoice records
        are kept for as long as tax and accounting laws require (generally 8 years). Security logs
        are kept for a limited time. When data is no longer needed, we delete or anonymise it.
      </p>

      <h2>6. How we protect it</h2>
      <p>
        Connections are encrypted (HTTPS), passwords are hashed, sensitive owner data is encrypted,
        and access is limited to people who need it, with every admin action recorded.
      </p>

      <h2>7. Your rights</h2>
      <ul>
        <li>See the personal data we hold about you.</li>
        <li>Correct or update it. You can change most details on your account page.</li>
        <li>Ask us to delete it, where we are not required to keep it by law.</li>
        <li>Withdraw consent. This may mean we can no longer provide some services.</li>
        <li>Nominate someone to act for you in case of death or incapacity.</li>
        <li>
          Raise a grievance with our Grievance Officer, and then with the Data Protection Board of
          India.
        </li>
      </ul>
      <p>
        Email <a [href]="'mailto:' + L.supportEmail">{{ L.supportEmail }}</a> from the address on
        your account. We reply within 30 days.
      </p>

      <h2>8. Children</h2>
      <p>MandapamBook is for adults. We do not knowingly collect data from anyone under 18.</p>

      <h2>9. Changes</h2>
      <p>
        We will update this policy when our practices change; the date at the top shows the latest
        version. For significant changes we will tell you by email.
      </p>

      <h2>10. Contact and Grievance Officer</h2>
      <p>See <a routerLink="/contact">Contact us</a>.</p>
    </app-legal-shell>
  `,
})
export class Privacy {
  protected readonly L = LEGAL;
}
