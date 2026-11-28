import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { permissionsFor } from '@mandapambook/shared';
import { AuthService } from '../../core/auth/auth.service';
import type { RefundStatus, RefundUpdate } from '../../core/booking-api.service';
import { RefundNotice } from '../../shared/refund-notice';
import { RefundStatusCard } from './refund-status-card';

const PROCESSING: RefundStatus = {
  amountPaise: 673_950,
  status: 'PROCESSING',
  startedAt: '2026-11-27T05:00:00Z',
  completedAt: null,
  reference: 'rfnd_ABC123',
};
const COMPLETED: RefundStatus = {
  ...PROCESSING,
  status: 'COMPLETED',
  completedAt: '2026-12-02T05:00:00Z',
};

const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');

describe('refund status card', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(RefundStatusCard);
    fixture.componentRef.setInput('refCode', 'MB-ABC234');
    fixture.componentRef.setInput('eventDate', '2027-01-20');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a refund on its way with the steps, what to expect and how to get help', () => {
    const el = text(render({ refund: PROCESSING, cancelledAt: '2026-11-27T04:59:00Z' }));
    expect(el).toContain('Your refund is on its way');
    expect(el).toContain('₹6,739.50 is being returned');
    expect(el).toContain('Refund started · 27 Nov 2026');
    expect(el).toContain('usually within minutes');
    expect(el).toContain('Refund reference rfnd_ABC123');
    expect(el).toContain('support@mandapambooking.in');
  });

  it('shows a completed refund with its date', () => {
    const el = text(render({ refund: COMPLETED }));
    expect(el).toContain('Refund completed');
    expect(el).toContain(
      'sent back to the card, UPI or bank account you paid with on 2 December 2026',
    );
    expect(el).not.toContain('on its way');
  });

  it('explains when a paid cancellation got no refund', () => {
    const el = text(
      render({ paidAndCancelled: true, cancelledAt: '2027-01-17T06:00:00Z', refund: null }),
    );
    expect(el).toContain('No refund for this cancellation');
    expect(el).toContain('cancelled 3 days before the event');
  });

  it('shows nothing for a booking that was never paid', () => {
    expect(text(render({ cancelledAt: '2026-11-27T04:59:00Z' })).trim()).toBe('');
  });
});

describe('refund notice', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => localStorage.clear());

  async function render(signedIn: boolean, items: RefundUpdate[]) {
    if (signedIn) {
      const done = TestBed.inject(AuthService).login('asha@example.com', 'pw', false);
      http.expectOne('/api/v1/auth/login').flush({
        accessToken: 't',
        expiresIn: 900,
        user: {
          id: 'u1',
          email: 'asha@example.com',
          fullName: 'Asha',
          phone: null,
          role: 'CUSTOMER',
          emailVerified: true,
          phoneVerified: false,
          permissions: permissionsFor('CUSTOMER'),
        },
      });
      await done;
    }
    const fixture = TestBed.createComponent(RefundNotice);
    fixture.detectChanges();
    if (signedIn) {
      (await vi.waitFor(() => http.expectOne('/api/v1/bookings/refund-updates'))).flush({ items });
    }
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const update = (refund: RefundStatus, id = 'b1'): RefundUpdate => ({
    bookingId: id,
    refCode: 'MB-ABC234',
    venueName: 'Kovalam Road Auditorium',
    refund,
  });

  it('tells a signed-in customer their refund is being processed, with a link', async () => {
    const el = (await render(true, [update(PROCESSING)])).nativeElement as HTMLElement;
    expect(text(el)).toContain('Your refund of ₹6,739.50 is being processed.');
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/account/bookings/b1');
  });

  it('says when it is complete, and stays hidden once closed', async () => {
    const fixture = await render(true, [update(COMPLETED)]);
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el)).toContain('Your refund of ₹6,739.50 is complete.');
    el.querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    expect(text(el).trim()).toBe('');
    expect(localStorage.getItem('mb:refund-notices-seen')).toContain('b1:COMPLETED');
  });

  it('asks nothing and shows nothing when signed out', async () => {
    const el = (await render(false, [])).nativeElement as HTMLElement;
    http.expectNone('/api/v1/bookings/refund-updates');
    expect(text(el).trim()).toBe('');
  });
});
