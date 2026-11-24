import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AuthSession, Permission, Role } from '@mandapambook/shared';
import { authInterceptor } from '../core/auth/auth.interceptor';
import { AuthService } from '../core/auth/auth.service';
import type { BookingDetail } from '../core/booking-api.service';
import { FileDownload, filenameFrom } from '../core/file-download';
import { AdminPayouts, AdminReports } from './admin/insights';
import { BookingDetailPage } from './customer/bookings';
import { OwnerReviewsPage, financialYears } from './owner/insights';

const session = (role: Role, permissions: Permission[]): AuthSession => ({
  accessToken: `${role}-token`,
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'u@example.test',
    fullName: 'Test User',
    phone: null,
    role,
    emailVerified: true,
    phoneVerified: false,
    permissions,
  },
});

const completed: BookingDetail = {
  id: 'b1',
  refCode: 'MB-ABC123',
  status: 'COMPLETED',
  eventDate: '2026-10-01',
  slot: 'MORNING',
  guestCount: 400,
  venueName: 'Guruvayur Mahal',
  venueSlug: 'guruvayur-mahal',
  hallName: 'Main',
  city: 'Thrissur',
  totalPaise: 11_849_900,
  advancePaise: 2_962_475,
  refundDuePaise: null,
  holdExpiresAt: null,
  addressLine: 'East Nada',
  pincode: '680101',
  subtotalPaise: 10_000_000,
  addonsPaise: 0,
  gstPaise: 1_800_000,
  platformFeePaise: 49_900,
  cancellationTiers: [],
  history: [],
  review: null,
} as unknown as BookingDetail;

describe('helpers', () => {
  it('reads only safe file names from Content-Disposition', () => {
    expect(filenameFrom('attachment; filename="MB-2026-27-000001.pdf"', 'x.pdf')).toBe(
      'MB-2026-27-000001.pdf',
    );
    expect(filenameFrom('attachment; filename="../../etc/passwd"', 'x.pdf')).toBe('x.pdf');
    expect(filenameFrom(null, 'x.pdf')).toBe('x.pdf');
  });

  it('lists Indian financial years newest first', () => {
    expect(financialYears('2026-11-22', 2)).toEqual([
      { label: 'FY 2026-27', from: '2026-04-01', to: '2027-03-31' },
      { label: 'FY 2025-26', from: '2025-04-01', to: '2026-03-31' },
    ]);
    expect(financialYears('2027-01-15', 1)[0]!.label).toBe('FY 2026-27');
  });
});

describe('Phase 7 screens', () => {
  let http: HttpTestingController;
  const saved: { name: string; type: string }[] = [];

  async function signIn(
    role: Role,
    permissions: Permission[],
    phone: string | null = '+919847012345',
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const files = TestBed.inject(FileDownload);
    files.save = (blob, name) => void saved.push({ name, type: blob.type });
    const login = TestBed.inject(AuthService).login('u@example.test', 'pw', false);
    const s = session(role, permissions);
    http.expectOne('/api/v1/auth/login').flush({ ...s, user: { ...s.user, phone } });
    await login;
  }

  const pending = (url: string) => vi.waitFor(() => http.expectOne(url));
  afterEach(() => http.verify());

  it('lets a customer download the invoice with their token and post a star review', async () => {
    await signIn('CUSTOMER', ['booking:create', 'booking:cancel_own', 'review:create']);
    const fixture = TestBed.createComponent(BookingDetailPage);
    fixture.componentRef.setInput('id', 'b1');
    fixture.detectChanges();
    (await pending('/api/v1/bookings/b1')).flush(completed);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const invoice = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Download invoice'),
    )!;
    invoice.click();
    const req = await pending('/api/v1/bookings/b1/invoice.pdf');
    expect(req.request.headers.get('Authorization')).toBe('Bearer CUSTOMER-token');
    req.flush(new Blob(['%PDF-'], { type: 'application/pdf' }), {
      headers: { 'Content-Disposition': 'attachment; filename="MB-2026-27-000001.pdf"' },
    });
    await vi.waitFor(() =>
      expect(saved.at(-1)).toEqual({ name: 'MB-2026-27-000001.pdf', type: 'application/pdf' }),
    );

    const post = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Post review'),
    )!;
    expect(post.disabled).toBe(true);
    (el.querySelector('[aria-label="4 stars"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="4 stars"]')!.getAttribute('aria-checked')).toBe('true');
    expect(post.disabled).toBe(false);
    post.click();
    const created = await pending('/api/v1/bookings/b1/review');
    expect(created.request.body).toEqual({ rating: 4, body: '' });
    created.flush({ id: 'r1' });
    (await pending('/api/v1/bookings/b1')).flush({ ...completed, review: { id: 'r1', rating: 4 } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('You rated this venue 4 out of 5');
  });

  it('asks for a mobile number before a customer can review', async () => {
    await signIn('CUSTOMER', ['booking:create', 'review:create'], null);
    const fixture = TestBed.createComponent(BookingDetailPage);
    fixture.componentRef.setInput('id', 'b1');
    fixture.detectChanges();
    (await pending('/api/v1/bookings/b1')).flush(completed);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('we need a mobile number on your account');
    expect(
      [...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Post review')),
    ).toBe(false);
    const link = [...el.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Add your mobile number'),
    )!;
    expect(link.getAttribute('href')).toBe('/account#phone');
    http.match(() => true).forEach((r) => r.flush(null));
  });

  it('hides the reply action from staff', async () => {
    await signIn('OWNER_STAFF', ['booking:view_venue', 'calendar:manage']);
    const fixture = TestBed.createComponent(OwnerReviewsPage);
    fixture.detectChanges();
    (await pending('/api/v1/owner/reviews')).flush({
      items: [
        {
          id: 'r1',
          venueName: 'Mahal',
          rating: 5,
          body: 'Lovely',
          author: 'Priya N.',
          status: 'PUBLISHED',
          ownerReply: null,
          createdAt: '2026-10-02T00:00:00Z',
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Lovely');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Reply')).toBe(
      false,
    );
  });

  it('shows the admin summary and exports CSV for the chosen window', async () => {
    await signIn('ADMIN', ['report:view', 'payout:manage']);
    const fixture = TestBed.createComponent(AdminReports);
    fixture.detectChanges();
    const first = await vi.waitFor(() =>
      http.expectOne((r) => r.url === '/api/v1/admin/reports/summary'),
    );
    first.flush({
      from: '2026-04-01',
      to: '2027-03-31',
      bookingsByStatus: { CONFIRMED: 3 },
      bookingValuePaise: 30_000_000,
      collectedOnlinePaise: 9_000_000,
      refundedPaise: 0,
      platformFeesPaise: 149_700,
      commissionPaise: 2_400_000,
      payoutsPendingPaise: 0,
      payoutsPaidPaise: 0,
      topCities: [{ city: 'Kochi', bookings: 3, valuePaise: 35_000_000 }],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('₹3,00,000');
    expect(el.textContent).toContain('Kochi (3)');

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Export CSV'))!.click();
    const csv = await vi.waitFor(() =>
      http.expectOne((r) => r.url.startsWith('/api/v1/admin/reports/bookings.csv')),
    );
    expect(csv.request.urlWithParams).toContain('from=');
    csv.flush(new Blob(['ref'], { type: 'text/csv' }), {
      headers: {
        'Content-Disposition': 'attachment; filename="bookings-2026-04-01-to-2027-03-31.csv"',
      },
    });
    await vi.waitFor(() =>
      expect(saved.at(-1)?.name).toBe('bookings-2026-04-01-to-2027-03-31.csv'),
    );
  });

  it('marks a payout paid only with a reference', async () => {
    await signIn('ADMIN', ['payout:manage']);
    const fixture = TestBed.createComponent(AdminPayouts);
    fixture.detectChanges();
    const row = {
      id: 'p1',
      refCode: 'MB-1',
      eventDate: '2026-10-01',
      venueName: 'Mahal',
      grossPaise: 1,
      commissionPaise: 0,
      netPaise: 2_150_100,
      status: 'PENDING',
      reference: null,
      paidAt: null,
    };
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/v1/admin/payouts'))).flush({
      items: [row],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Mark paid'),
    )!;
    expect(button.disabled).toBe(true);
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'UTR998877';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(button.disabled).toBe(false);
    button.click();
    const req = await pending('/api/v1/admin/payouts/p1/mark-paid');
    expect(req.request.body).toEqual({ reference: 'UTR998877' });
    req.flush({ id: 'p1', status: 'PAID' });
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/v1/admin/payouts'))).flush({
      items: [],
    });
    await fixture.whenStable();
  });
});
