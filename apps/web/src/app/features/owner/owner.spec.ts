import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AuthSession } from '@mandapambook/shared';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import { OwnerApi, type VenueDetail } from '../../core/owner-api.service';
import { InrPipe, rupeesToPaiseInput } from '../../shared/inr.pipe';
import { isoDate } from './editor/calendar';
import { VenueEditor } from './editor/venue-editor';

const ownerSession: AuthSession = {
  accessToken: 'owner-token',
  expiresIn: 900,
  user: {
    id: 'o1',
    email: 'owner@example.test',
    fullName: 'Anil Menon',
    phone: null,
    role: 'OWNER',
    emailVerified: true,
    phoneVerified: false,
    permissions: [
      'auditorium:create',
      'auditorium:update',
      'pricing:update',
      'booking:view_venue',
      'calendar:manage',
      'kyc:update',
      'staff:manage',
    ],
  },
};

const venue: VenueDetail = {
  id: 'v1',
  name: 'Sree Padmanabha Kalyana Mandapam',
  slug: 'sree-padmanabha',
  status: 'DRAFT',
  cityId: 'c1',
  rejectionReason: null,
  updatedAt: '2026-11-22T00:00:00Z',
  description: '',
  addressLine: 'Temple Road',
  locality: null,
  pincode: '682024',
  latitude: null,
  longitude: null,
  cateringPolicy: 'OUTSIDE_ALLOWED',
  decorationPolicy: 'OUTSIDE_ALLOWED',
  parkingCars: 0,
  parkingTwoWheelers: 0,
  guestRooms: 0,
  hasGenerator: false,
  advancePercent: 25,
  instantBook: true,
  halls: [],
  amenities: [],
  addons: [],
  cancellationPolicy: null,
  photos: [],
};

describe('money helpers', () => {
  it('formats paise with Indian grouping and converts rupee input to paise', () => {
    expect(new InrPipe().transform(14_000_000)).toBe('₹1,40,000.00');
    expect(new InrPipe().transform(null)).toBe('');
    expect(rupeesToPaiseInput(85000)).toBe(8_500_000);
    expect(() => rupeesToPaiseInput(-1)).toThrow();
  });

  it('builds calendar dates without timezone drift', () => {
    expect(isoDate(2027, 0, 5)).toBe('2027-01-05');
    expect(isoDate(2027, 11, 31)).toBe('2027-12-31');
  });
});

describe('owner area', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);
    const login = auth.login('owner@example.test', 'pw', false);
    http.expectOne('/api/v1/auth/login').flush(ownerSession);
    await login;
  });

  afterEach(() => http.verify());

  const pending = (url: string) => vi.waitFor(() => http.expectOne(url));

  it('uploads photos straight to storage without leaking the access token, then confirms', async () => {
    const api = TestBed.inject(OwnerApi);
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'stage.png', { type: 'image/png' });
    const done = api.uploadPhoto('v1', file, 'stage');

    const reserve = await pending('/api/v1/owner/auditoriums/v1/media/upload-url');
    expect(reserve.request.body).toEqual({ mimeType: 'image/png', sizeBytes: 4, altText: 'stage' });
    expect(reserve.request.headers.get('Authorization')).toBe('Bearer owner-token');
    reserve.flush({
      mediaId: 'm1',
      upload: {
        url: 'https://storage.example.test/bucket/key?X-Amz-Signature=abc',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'Content-Length': '4' },
      },
    });

    const put = await pending('https://storage.example.test/bucket/key?X-Amz-Signature=abc');
    expect(put.request.method).toBe('PUT');
    expect(put.request.headers.get('Content-Type')).toBe('image/png');
    expect(put.request.headers.has('Authorization')).toBe(false);
    put.flush(null);

    (await pending('/api/v1/owner/media/m1/confirm')).flush({ id: 'm1', status: 'READY' });
    await done;
  });

  it('shows what is missing when a listing is not ready for review', async () => {
    const fixture = TestBed.createComponent(VenueEditor);
    fixture.componentRef.setInput('id', 'v1');
    fixture.detectChanges();
    (await pending('/api/v1/owner/auditoriums/v1')).flush(venue);
    await fixture.whenStable();
    // The details tab loads the city list.
    (await pending('/api/v1/cities')).flush({
      items: [{ id: 'c1', name: 'Kochi', district: 'Ernakulam', state: 'Kerala' }],
    });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Sree Padmanabha');
    const submit = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Submit for review'),
    )!;
    submit.click();
    (await pending('/api/v1/owner/auditoriums/v1/submit')).flush(
      {
        error: {
          code: 'LISTING_INCOMPLETE',
          message: 'Finish these',
          details: ['Add at least one hall', 'Set a cancellation policy'],
        },
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await fixture.whenStable();
    const alert = el.querySelector('[role=alert]');
    expect(alert?.textContent).toContain('Add at least one hall');
    expect(alert?.textContent).toContain('Set a cancellation policy');
  });

  it('exposes tabs with proper roles', async () => {
    const fixture = TestBed.createComponent(VenueEditor);
    fixture.componentRef.setInput('id', 'v1');
    fixture.detectChanges();
    (await pending('/api/v1/owner/auditoriums/v1')).flush(venue);
    await fixture.whenStable();
    (await pending('/api/v1/cities')).flush({ items: [] });
    await fixture.whenStable();
    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll('[role=tab]');
    expect(tabs).toHaveLength(5);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });
});
