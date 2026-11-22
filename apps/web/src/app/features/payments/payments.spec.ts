import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from '../../app';
import { BrowserNavigation } from '../../core/browser-navigation';
import { PaymentAdapter } from './payment-adapter';
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
