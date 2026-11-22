import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type AuthSession, permissionsFor } from '@mandapambook/shared';
import type { ReviewDetail } from '../../core/admin-api.service';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import { AdminListingReview } from './listings';
import { AdminOwnersKyc } from './owners-kyc';
import { AdminSettings } from './settings';

function session(role: 'ADMIN' | 'SUPER_ADMIN'): AuthSession {
  return {
    accessToken: 'admin-token',
    expiresIn: 900,
    user: {
      id: 'a1',
      email: 'admin@example.test',
      fullName: 'Demo Admin',
      phone: null,
      role,
      emailVerified: true,
      phoneVerified: false,
      permissions: permissionsFor(role),
    },
  };
}

const review: ReviewDetail = {
  id: 'v1',
  name: 'Vadakkunnathan Convention Centre',
  status: 'PENDING_REVIEW',
  city: 'Thrissur',
  description: 'Large hall',
  addressLine: 'Round North',
  pincode: '680001',
  cateringPolicy: 'IN_HOUSE_ONLY',
  decorationPolicy: 'IN_HOUSE_ONLY',
  advancePercent: 30,
  instantBook: false,
  rejectionReason: null,
  owner: {
    id: 'o1',
    fullName: 'Anil Menon',
    email: 'owner@example.test',
    phone: null,
    businessName: 'Menon',
    kycStatus: 'VERIFIED',
  },
  halls: [],
  amenities: [],
  cancellationPolicy: null,
  photos: [],
  gaps: [],
};

describe('admin screens', () => {
  let http: HttpTestingController;
  const pending = (url: string) => vi.waitFor(() => http.expectOne(url));
  /** Waits for an element to render (async loads settle a tick after the HTTP flush). */
  const find = <T extends Element>(root: HTMLElement, selector: string) =>
    vi.waitFor(() => {
      const found = root.querySelector<T>(selector);
      if (!found) throw new Error(`not rendered yet: ${selector}`);
      return found;
    });

  async function signIn(role: 'ADMIN' | 'SUPER_ADMIN'): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const done = TestBed.inject(AuthService).login('admin@example.test', 'pw', false);
    http.expectOne('/api/v1/auth/login').flush(session(role));
    await done;
  }

  afterEach(() => http.verify());

  it('sends a rejection with the reason the admin typed', async () => {
    await signIn('ADMIN');
    const fixture = TestBed.createComponent(AdminListingReview);
    fixture.componentRef.setInput('id', 'v1');
    fixture.detectChanges();
    (await pending('/api/v1/admin/listings/v1')).flush(review);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    await find(el, 'input[type=radio]');
    const radio = [...el.querySelectorAll('label')]
      .find((l) => l.textContent?.includes('Ask for changes'))!
      .querySelector<HTMLInputElement>('input[type=radio]')!;
    radio.click();
    await fixture.whenStable();
    const textarea = await find<HTMLTextAreaElement>(el, 'textarea[name=reason]');
    textarea.value = 'Please add photos of the dining hall';
    textarea.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();

    const req = await pending('/api/v1/admin/listings/v1/decision');
    expect(req.request.body).toEqual({
      decision: 'reject',
      reason: 'Please add photos of the dining hall',
    });
    req.flush({ status: 'REJECTED' });
    (await pending('/api/v1/admin/listings/v1')).flush({ ...review, status: 'REJECTED' });
    await fixture.whenStable();
    expect((await find(el, '[role=status]')).textContent).toContain('rejected');
  });

  it('only reveals full KYC numbers after sending a purpose', async () => {
    await signIn('ADMIN');
    const fixture = TestBed.createComponent(AdminOwnersKyc);
    fixture.detectChanges();
    (await pending('/api/v1/admin/owners?kycStatus=SUBMITTED')).flush({
      items: [
        {
          ownerId: 'o1',
          email: 'o@example.test',
          fullName: 'Owner',
          businessName: 'Biz',
          panMasked: 'XXXXXX234K',
          bankAccountMasked: 'XXXXXXXX7890',
          ifsc: 'HDFC0001234',
          gstin: null,
          bankAccountName: 'Biz',
          kycStatus: 'SUBMITTED',
          kycRejectionReason: null,
          updatedAt: '',
        },
      ],
      total: 1,
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('XXXXXX234K');

    const purpose = el.querySelector<HTMLInputElement>('input[placeholder="e.g. match PAN card"]')!;
    purpose.value = 'Match PAN card';
    purpose.dispatchEvent(new Event('input'));
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Show full numbers'))!
      .click();
    const req = await pending('/api/v1/admin/owners/o1/kyc/reveal');
    expect(req.request.body).toEqual({ purpose: 'Match PAN card' });
    req.flush({
      pan: 'ABCPM1234K',
      bankAccountNumber: '001234567890',
      ifsc: 'HDFC0001234',
      gstin: null,
      bankAccountName: 'Biz',
    });
    await fixture.whenStable();
    expect(el.textContent).toContain('ABCPM1234K');
  });

  it('converts percentages and rupees to basis points and paise when saving settings', async () => {
    await signIn('SUPER_ADMIN');
    const fixture = TestBed.createComponent(AdminSettings);
    fixture.detectChanges();
    (await pending('/api/v1/admin/settings')).flush({
      commission_bps: 800,
      platform_fee_paise: 49900,
      gst_bps: 1800,
      hold_minutes: 10,
      owner_response_hours: 24,
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const commission = await find<HTMLInputElement>(el, 'input[name=commission]');
    await vi.waitFor(() => expect(commission.value).toBe('8'));
    commission.value = '7.5';
    commission.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const req = await pending('/api/v1/admin/settings');
    expect(req.request.body).toEqual({
      commission_bps: 750,
      platform_fee_paise: 49900,
      gst_bps: 1800,
      hold_minutes: 10,
      owner_response_hours: 24,
    });
    req.flush({
      commission_bps: 750,
      platform_fee_paise: 49900,
      gst_bps: 1800,
      hold_minutes: 10,
      owner_response_hours: 24,
    });
  });

  it('does not offer to save settings to plain admins', async () => {
    await signIn('ADMIN');
    const fixture = TestBed.createComponent(AdminSettings);
    fixture.detectChanges();
    (await pending('/api/v1/admin/settings')).flush({
      commission_bps: 800,
      platform_fee_paise: 49900,
      gst_bps: 1800,
      hold_minutes: 10,
      owner_response_hours: 24,
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    await find(el, 'input[name=commission]');
    expect(el.querySelector('button[type=submit]')).toBeNull();
    expect(el.textContent).toContain('Only super admins');
  });
});
