import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LEGAL } from './legal-info';
import { LegalShell } from './legal-shell';

@Component({
  selector: 'app-contact',
  imports: [LegalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-legal-shell heading="Contact us">
      <p>
        We're here to help with bookings, payments, refunds and listing your venue. Include your
        booking reference (for example MB-ABC234) if your question is about a booking.
      </p>

      <h2>Customer support</h2>
      <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        <dt class="font-semibold text-ink">Email</dt>
        <dd>
          <a [href]="'mailto:' + L.supportEmail">{{ L.supportEmail }}</a>
        </dd>
        <dt class="font-semibold text-ink">Phone</dt>
        <dd>
          @if (L.phone) {
            <a [href]="'tel:' + L.phone.replaceAll(' ', '')">{{ L.phone }}</a>
          } @else {
            <span class="text-slate-500">Will be published here shortly.</span>
          }
        </dd>
        <dt class="font-semibold text-ink">Hours</dt>
        <dd>{{ L.supportHours }}</dd>
        <dt class="font-semibold text-ink">We reply</dt>
        <dd>Within 2 working days.</dd>
      </dl>

      <h2>Business details</h2>
      <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        <dt class="font-semibold text-ink">Operated by</dt>
        <dd>{{ L.operatorDescription }}</dd>
        <dt class="font-semibold text-ink">Address</dt>
        <dd>
          @if (L.address) {
            <address class="not-italic">
              @for (line of L.address; track line) {
                {{ line }}<br />
              }
            </address>
          } @else {
            <span class="text-slate-500">Will be published here shortly.</span>
          }
        </dd>
        <dt class="font-semibold text-ink">Website</dt>
        <dd>{{ L.website }}</dd>
      </dl>

      <h2>Grievance Officer</h2>
      <p>
        Under the Consumer Protection (E-Commerce) Rules, 2020 and the Information Technology rules,
        you can raise a complaint with our Grievance Officer. We acknowledge complaints within 48
        hours and resolve them within one month.
      </p>
      <dl class="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        <dt class="font-semibold text-ink">Name</dt>
        <dd>
          @if (L.grievanceOfficer.name) {
            {{ L.grievanceOfficer.name }}
          } @else {
            <span class="text-slate-500">Will be published here shortly.</span>
          }
        </dd>
        <dt class="font-semibold text-ink">Email</dt>
        <dd>
          <a [href]="'mailto:' + L.grievanceOfficer.email">{{ L.grievanceOfficer.email }}</a>
        </dd>
      </dl>
    </app-legal-shell>
  `,
})
export class Contact {
  protected readonly L = LEGAL;
}
