import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { errorMessage } from '../../core/auth/auth.service';
import { BrowserNavigation } from '../../core/browser-navigation';
import { type PaymentOrder, PaymentsService } from '../../core/payments.service';
import { InrPipe } from '../../shared/inr.pipe';

/**
 * The only gateway-aware code in the web app. It asks our API for an order and hands the
 * browser to whichever checkout the active provider needs:
 * - mock: our hosted test checkout page (a redirect), which returns to /payments/return
 * - razorpay: TODO load checkout.js and open it with checkout.keyId / checkout.orderId,
 *   then send the handler's ids and signature to /payments/verify (see docs/payments-migration.md)
 */
@Component({
  selector: 'app-payment-adapter',
  imports: [InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2">
      <button
        type="button"
        class="w-full rounded-md bg-brand-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
        [disabled]="busy()"
        (click)="pay()"
      >
        {{ busy() ? 'Opening payment…' : 'Pay ' + (amountPaise() | inr) + ' now' }}
      </button>
      @if (error()) {
        <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
    </div>
  `,
})
export class PaymentAdapter {
  private readonly payments = inject(PaymentsService);
  private readonly navigation = inject(BrowserNavigation);
  readonly bookingId = input.required<string>();
  readonly amountPaise = input.required<number>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly attemptKey = `pay-${crypto.randomUUID()}`;

  protected async pay(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const order = await this.payments.createOrder(this.bookingId(), this.attemptKey);
      this.open(order);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not start the payment. Try again.'));
      this.busy.set(false);
    }
  }

  private open(order: PaymentOrder): void {
    switch (order.checkout['kind']) {
      case 'redirect': {
        const url = order.checkout['url'] ?? '';
        // Only same-origin, path-only checkout URLs are followed.
        if (!url.startsWith('/') || url.startsWith('//'))
          throw new Error('unexpected checkout url');
        this.navigation.assign(url);
        return;
      }
      default:
        this.error.set('This payment method is not available yet.');
        this.busy.set(false);
    }
  }
}
