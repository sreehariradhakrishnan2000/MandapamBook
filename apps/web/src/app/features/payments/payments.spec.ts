import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from '../../app';
import { BrowserNavigation } from '../../core/browser-navigation';
import { PaymentsService } from '../../core/payments.service';
import { PaymentAdapter, RazorpayLoader, type RazorpayConstructor } from './payment-adapter';
import { PaymentReturn } from './payment-return';

describe('payments in the web app', () => {
  let http: HttpTestingController;
  const pending = (url: string) => vi.waitFor(() => http.expectOne((r) => r.url === url));

  function setup(location?: { assign: (u: string) => void }) {
    const providers: unknown[] = [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ];
    if (location) {
      providers.push({ provide: BrowserNavigation, useValue: location });
    }
    TestBed.configureTestingModule({ providers: providers as never[] });
    http = TestBed.inject(HttpTestingController);
  }

  it('shows the TEST MODE banner only when the mock gateway is active', async () => {
    setup();
    const fixture = TestBed.createComponent(App);
    (await pending('/api/v1/payments/config')).flush({ provider: 'mock', testMode: true });
    await vi.waitFor(() =>
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('TEST MODE'),
    );

    const live = TestBed.createComponent(App);
    (await pending('/api/v1/payments/config')).flush({ provider: 'razorpay', testMode: false });
    await live.whenStable();
    expect((live.nativeElement as HTMLElement).textContent).not.toContain('TEST MODE');
  });

  it('says "test payments only" next to the Pay button while the gateway is in test mode', async () => {
    setup();
    const payments = TestBed.inject(PaymentsService);
    const fixture = TestBed.createComponent(PaymentAdapter);
    fixture.componentRef.setInput('bookingId', 'b1');
    fixture.componentRef.setInput('amountPaise', 100);
    payments.config.set({ provider: 'razorpay', testMode: true });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Test payments only – no real money is charged');

    payments.config.set({ provider: 'razorpay', testMode: false });
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Test payments only');
  });

  it('creates an order with an idempotency key and opens the same-origin checkout', async () => {
    const assign = vi.fn();
    setup({ assign });
    const fixture = TestBed.createComponent(PaymentAdapter);
    fixture.componentRef.setInput('bookingId', 'b1');
    fixture.componentRef.setInput('amountPaise', 3_589_900);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(button.textContent).toContain('₹35,899.00');

    // First attempt fails at the gateway; the retry must reuse the same key.
    button.click();
    const first = await pending('/api/v1/payments/orders');
    const key = first.request.headers.get('Idempotency-Key');
    expect(key).toMatch(/^pay-[0-9a-f-]{36}$/);
    first.flush(
      { error: { code: 'PAYMENT_PROVIDER_ERROR', message: 'Try again' } },
      { status: 502, statusText: 'Bad Gateway' },
    );
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    button.click();
    const retry = await pending('/api/v1/payments/orders');
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush({
      paymentId: 'p1',
      provider: 'mock',
      providerOrderId: 'mock_order_1',
      amountPaise: 3_589_900,
      currency: 'INR',
      testMode: true,
      checkout: { kind: 'redirect', url: '/api/v1/payments/mock/checkout/mock_order_1' },
    });
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/api/v1/payments/mock/checkout/mock_order_1'),
    );
  });

  it('opens Razorpay checkout and hands its signed result to the return page', async () => {
    setup();
    let options: Record<string, unknown> = {};
    const open = vi.fn();
    const handlers: Record<string, (r: unknown) => void> = {};
    class FakeRazorpay {
      constructor(o: Record<string, unknown>) {
        options = o;
      }
      open = open;
      on(event: string, h: (r: unknown) => void) {
        handlers[event] = h;
      }
    }
    vi.spyOn(TestBed.inject(RazorpayLoader), 'load').mockResolvedValue(
      FakeRazorpay as unknown as RazorpayConstructor,
    );
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(PaymentAdapter);
    fixture.componentRef.setInput('bookingId', 'b1');
    fixture.componentRef.setInput('amountPaise', 3_589_900);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('button')!.click();
    (await pending('/api/v1/payments/orders')).flush({
      paymentId: 'p1',
      provider: 'razorpay',
      providerOrderId: 'order_A',
      amountPaise: 3_589_900,
      currency: 'INR',
      testMode: true,
      checkout: {
        kind: 'razorpay',
        keyId: 'rzp_test_x',
        orderId: 'order_A',
        amount: '3589900',
        currency: 'INR',
      },
    });
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(options).toMatchObject({
      key: 'rzp_test_x',
      order_id: 'order_A',
      amount: 3_589_900,
      currency: 'INR',
      name: 'MandapamBook',
    });

    // A failed attempt shows Razorpay's reason and keeps the window open for a retry.
    handlers['payment.failed']!({ error: { description: 'Card declined by bank' } });
    await vi.waitFor(() =>
      expect(el.querySelector('[role=alert]')?.textContent).toContain('Card declined by bank'),
    );

    (options['handler'] as (r: unknown) => void)({
      razorpay_order_id: 'order_A',
      razorpay_payment_id: 'pay_B',
      razorpay_signature: 'sig',
    });
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(['/payments/return'], {
        queryParams: {
          orderId: 'order_A',
          paymentId: 'pay_B',
          signature: 'sig',
          status: 'success',
        },
      }),
    );
  });

  it('lets the customer try again after closing the Razorpay window', async () => {
    setup();
    let options: Record<string, unknown> = {};
    class FakeRazorpay {
      constructor(o: Record<string, unknown>) {
        options = o;
      }
      open() {}
      on() {}
    }
    vi.spyOn(TestBed.inject(RazorpayLoader), 'load').mockResolvedValue(
      FakeRazorpay as unknown as RazorpayConstructor,
    );
    const fixture = TestBed.createComponent(PaymentAdapter);
    fixture.componentRef.setInput('bookingId', 'b1');
    fixture.componentRef.setInput('amountPaise', 100);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    button.click();
    (await pending('/api/v1/payments/orders')).flush({
      paymentId: 'p1',
      provider: 'razorpay',
      providerOrderId: 'order_A',
      amountPaise: 100,
      currency: 'INR',
      testMode: true,
      checkout: { kind: 'razorpay', keyId: 'rzp_test_x', orderId: 'order_A' },
    });
    await vi.waitFor(() => expect(options['modal']).toBeDefined());
    expect(button.disabled).toBe(true);
    (options['modal'] as { ondismiss: () => void }).ondismiss();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });

  it('refuses to follow a checkout URL on another origin', async () => {
    const assign = vi.fn();
    setup({ assign });
    const fixture = TestBed.createComponent(PaymentAdapter);
    fixture.componentRef.setInput('bookingId', 'b1');
    fixture.componentRef.setInput('amountPaise', 100);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    (await pending('/api/v1/payments/orders')).flush({
      paymentId: 'p1',
      provider: 'mock',
      providerOrderId: 'o',
      amountPaise: 100,
      currency: 'INR',
      testMode: true,
      checkout: { kind: 'redirect', url: 'https://evil.example/steal' },
    });
    await vi.waitFor(() =>
      expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')).not.toBeNull(),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('confirms the booking only after the server verifies the signed return', async () => {
    setup();
    const fixture = TestBed.createComponent(PaymentReturn);
    fixture.componentRef.setInput('orderId', 'mock_order_1');
    fixture.componentRef.setInput('paymentId', 'mock_pay_1');
    fixture.componentRef.setInput('signature', 'abc');
    fixture.componentRef.setInput('status', 'success');
    fixture.detectChanges();
    const req = await pending('/api/v1/payments/verify');
    expect(req.request.body).toEqual({
      providerOrderId: 'mock_order_1',
      providerPaymentId: 'mock_pay_1',
      signature: 'abc',
    });
    req.flush({
      id: 'p1',
      status: 'CAPTURED',
      bookingId: 'b1',
      bookingStatus: 'CONFIRMED',
      refCode: 'MB-7K3Q9X',
    });
    await vi.waitFor(() =>
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Booking confirmed'),
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('MB-7K3Q9X');
  });

  it('never calls verify for a failed checkout', async () => {
    setup();
    const fixture = TestBed.createComponent(PaymentReturn);
    fixture.componentRef.setInput('status', 'failure');
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Payment not completed'),
    );
    http.expectNone('/api/v1/payments/verify');
  });
});
