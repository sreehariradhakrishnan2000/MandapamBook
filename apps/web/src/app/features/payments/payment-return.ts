import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/auth/auth.service';
import { STATUS_LABELS } from '../../core/booking-api.service';
import { type PaymentStatus, PaymentsService } from '../../core/payments.service';

/** Where the gateway sends the browser back. Only the server's verification is trusted. */
@Component({
  selector: 'app-payment-return',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto flex max-w-md flex-col gap-4 py-10 text-center" aria-live="polite">
      @switch (state()) {
        @case ('checking') {
          <p>Confirming your payment…</p>
        }
        @case ('done') {
          @if (result(); as r) {
            @if (r.bookingStatus === 'CONFIRMED') {
              <h1 class="font-display text-2xl font-bold text-leaf-600">Booking confirmed</h1>
              <p>
                Reference <span class="font-mono font-semibold">{{ r.refCode }}</span>. We have
                emailed your confirmation.
              </p>
            } @else if (r.bookingStatus === 'AWAITING_OWNER') {
              <h1 class="font-display text-2xl font-bold">Payment received</h1>
              <p>
                The venue will confirm your request within a day. If they decline, you get a full
                refund.
              </p>
            } @else {
              <h1 class="font-display text-2xl font-bold">Payment received</h1>
              <p>
                Your booking is {{ statusLabels[r.bookingStatus].toLowerCase() }}. Any amount we
                cannot use is refunded automatically.
              </p>
            }
            <a
              [routerLink]="['/account/bookings', r.bookingId]"
              class="font-semibold text-brand-700 underline"
              >View booking</a
            >
          }
        }
        @case ('failed') {
          <h1 class="font-display text-2xl font-bold">Payment not completed</h1>
          <p>{{ message() }}</p>
          <a routerLink="/account/bookings" class="font-semibold text-brand-700 underline"
            >My bookings</a
          >
        }
        @case ('pending') {
          <h1 class="font-display text-2xl font-bold">Payment pending</h1>
          <p>
            Your bank has not confirmed the payment yet. We'll update your booking as soon as it
            does.
          </p>
          <a routerLink="/account/bookings" class="font-semibold text-brand-700 underline"
            >My bookings</a
          >
        }
      }
    </section>
  `,
})
export class PaymentReturn implements OnInit {
  private readonly payments = inject(PaymentsService);
  readonly orderId = input<string>();
  readonly paymentId = input<string>();
  readonly signature = input<string>();
  readonly status = input<string>();

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly state = signal<'checking' | 'done' | 'failed' | 'pending'>('checking');
  protected readonly result = signal<PaymentStatus | null>(null);
  protected readonly message = signal(
    'The payment did not go through. Your date stays on hold until the timer runs out, so you can try again.',
  );

  async ngOnInit(): Promise<void> {
    if (this.status() === 'failure') {
      this.state.set('failed');
      return;
    }
    if (this.status() === 'pending') {
      this.state.set('pending');
      return;
    }
    const [providerOrderId, providerPaymentId, signature] = [
      this.orderId(),
      this.paymentId(),
      this.signature(),
    ];
    if (!providerOrderId || !providerPaymentId || !signature) {
      this.message.set('This payment link is incomplete.');
      this.state.set('failed');
      return;
    }
    try {
      this.result.set(
        await this.payments.verify({ providerOrderId, providerPaymentId, signature }),
      );
      this.state.set('done');
    } catch (err) {
      this.message.set(errorMessage(err, this.message()));
      this.state.set('failed');
    }
  }
}
