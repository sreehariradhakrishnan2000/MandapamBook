import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  NgZone,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, errorMessage } from '../../core/auth/auth.service';
import { BrowserNavigation } from '../../core/browser-navigation';
import { type PaymentOrder, PaymentsService } from '../../core/payments.service';
import { InrPipe } from '../../shared/inr.pipe';

/**
 * The only gateway-aware code in the web app. It asks our API for an order and hands the
 * browser to whichever checkout the active provider needs:
 * - mock: our hosted test checkout page (a redirect), which returns to /payments/return
 * - razorpay: Razorpay's Standard Checkout (loaded from checkout.razorpay.com) opens over the
 *   page; on success its ids and signature go to /payments/return, which verifies them with
 *   our API. The signature check and the webhook decide what is paid, never this code.
 */
@Component({
  selector: 'app-payment-adapter',
  imports: [InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2">
      @if (payments.config()?.testMode) {
        <p
          class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-center text-sm font-semibold text-red-800"
          role="note"
        >
          Test payments only – no real money is charged
        </p>
      }
      <button
        type="button"
        class="w-full rounded-full bg-brand-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
        [disabled]="busy()"
        (click)="pay()"
      >
        {{ busy() ? 'Opening payment…' : 'Pay ' + (amountPaise() | inr) + ' now' }}
      </button>
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
    </div>
  `,
})
export class PaymentAdapter {
  protected readonly payments = inject(PaymentsService);
  private readonly navigation = inject(BrowserNavigation);
  private readonly razorpayLoader = inject(RazorpayLoader);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
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
      case 'razorpay':
        void this.openRazorpay(order);
        return;
      default:
        this.error.set('This payment method is not available yet.');
        this.busy.set(false);
    }
  }

  private async openRazorpay(order: PaymentOrder): Promise<void> {
    const { keyId, orderId, amount, currency } = order.checkout;
    if (!keyId || !orderId) throw new Error('incomplete razorpay checkout');
    try {
      const Razorpay = await this.razorpayLoader.load();
      const user = this.auth.user();
      const rzp = new Razorpay({
        key: keyId,
        order_id: orderId,
        amount: Number(amount ?? order.amountPaise),
        currency: currency ?? 'INR',
        name: 'MandapamBook',
        description: 'Booking advance',
        prefill: {
          ...(user?.fullName ? { name: user.fullName } : {}),
          ...(user?.email ? { email: user.email } : {}),
          ...(user?.phone ? { contact: user.phone } : {}),
        },
        theme: { color: '#c2410c' },
        handler: (r: RazorpaySuccess) => {
          this.zone.run(() => {
            void this.router.navigate(['/payments/return'], {
              queryParams: {
                orderId: r.razorpay_order_id,
                paymentId: r.razorpay_payment_id,
                signature: r.razorpay_signature,
                status: 'success',
              },
            });
          });
        },
        modal: {
          // Closing the window is not a failure: the hold stays, so they can pay again.
          ondismiss: () => this.zone.run(() => this.busy.set(false)),
        },
      });
      rzp.on('payment.failed', (r: RazorpayFailure) => {
        this.zone.run(() => {
          this.error.set(
            r.error?.description
              ? `The payment did not go through: ${r.error.description}`
              : 'The payment did not go through. You can try again.',
          );
        });
      });
      rzp.open();
    } catch {
      this.error.set('Could not open the payment window. Check your connection and try again.');
      this.busy.set(false);
    }
  }
}

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error?: { description?: string; reason?: string };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (r: RazorpayFailure) => void): void;
}

export type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

export const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** Loads Razorpay's checkout script once, on first use (so other pages never load it). */
@Injectable({ providedIn: 'root' })
export class RazorpayLoader {
  private loading: Promise<RazorpayConstructor> | null = null;

  load(): Promise<RazorpayConstructor> {
    const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
    if (existing) return Promise.resolve(existing);
    this.loading ??= new Promise<RazorpayConstructor>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = RAZORPAY_CHECKOUT_SRC;
      script.async = true;
      script.onload = () => {
        const ctor = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
        if (ctor) resolve(ctor);
        else reject(new Error('Razorpay did not load'));
      };
      script.onerror = () => {
        this.loading = null;
        script.remove();
        reject(new Error('Razorpay did not load'));
      };
      document.head.appendChild(script);
    });
    return this.loading;
  }
}
