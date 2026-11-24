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
import { VenueForm } from './editor/venue-form';
import { OfflineBookings } from './editor/offline-bookings';

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
  sadyaPrepArea: false,
  cookingEquipment: false,
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

  it('saves a map pin read from a pasted Google Maps link, and rejects one it cannot read', async () => {
    const fixture = TestBed.createComponent(VenueForm);
    fixture.componentRef.setInput('venue', venue);
    fixture.detectChanges();
    (await pending('/api/v1/cities')).flush({
      items: [{ id: 'c1', name: 'Kochi', state: 'Kerala' }],
    });
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const field = el.querySelector<HTMLInputElement>('#location')!;
    const submit = () => {
      el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      fixture.detectChanges();
    };

    field.value = 'https://maps.app.goo.gl/AbCdEf123';
    field.dispatchEvent(new Event('input'));
    submit();
    expect(el.textContent).toContain('Could not read a location');
    http.expectNone('/api/v1/owner/auditoriums/v1');

    field.value =
      'https://www.google.com/maps/place/Hall/@10.02,76.30,17z/data=!3d10.0261!4d76.3084';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('a[href^="https://www.google.com/maps/search/"]')).not.toBeNull();
    submit();
    const save = await pending('/api/v1/owner/auditoriums/v1');
    expect(save.request.body).toMatchObject({ latitude: 10.0261, longitude: 76.3084 });
    expect(save.request.body).not.toHaveProperty('location');
    save.flush({ ...venue, latitude: 10.0261, longitude: 76.3084 });
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

  it('records an offline booking over several dates, and checks it first', async () => {
    const fixture = TestBed.createComponent(OfflineBookings);
    fixture.componentRef.setInput('venueId', 'v1');
    fixture.componentRef.setInput('halls', [
      {
        id: 'h1',
        name: 'Main Hall',
        seatingCapacity: 500,
        diningCapacity: 200,
        isAc: true,
        diningIsAc: true,
        isActive: true,
      },
    ]);
    fixture.detectChanges();
    (await pending('/api/v1/owner/auditoriums/v1/offline-bookings?status=ALL')).flush({
      items: [],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No offline bookings recorded.');

    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Record an offline booking'))!
      .click();
    fixture.detectChanges();
    await fixture.whenStable();
    const set = async (selector: string, value: string) => {
      const field = el.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      if (!field) throw new Error(`no field ${selector}`);
      field.value = value;
      field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input'));
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const submit = async () => {
      el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    await set('fieldset > div:nth-of-type(1) input[type=date]', '2030-01-09');
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Add another date'))!
      .click();
    fixture.detectChanges();
    await fixture.whenStable();
    await set('fieldset > div:nth-of-type(2) input[type=date]', '2030-01-10');
    await set('fieldset > div:nth-of-type(2) select', 'MORNING');
    await set('input[name=customerName]', 'Lakshmi Nair');
    await set('input[name=customerPhone]', '12345');
    await submit();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('valid 10-digit');

    await set('input[name=customerPhone]', '98470 12345');
    await set('input[name=amount]', '150000');
    await set('input[name=advance]', '200000');
    await submit();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'cannot be more than the amount',
    );
    http.expectNone('/api/v1/owner/auditoriums/v1/offline-bookings');

    await set('input[name=advance]', '50000');
    await submit();
    const save = await pending('/api/v1/owner/auditoriums/v1/offline-bookings');
    expect(save.request.method).toBe('POST');
    expect(save.request.body).toEqual({
      hallId: 'h1',
      slots: [
        { eventDate: '2030-01-09', slot: 'FULL_DAY' },
        { eventDate: '2030-01-10', slot: 'MORNING' },
      ],
      customerName: 'Lakshmi Nair',
      customerPhone: '98470 12345',
      amountPaise: 15_000_000,
      advancePaise: 5_000_000,
    });
    save.flush({});
    const booking = {
      id: 'o1',
      hallId: 'h1',
      hallName: 'Main Hall',
      customerName: 'Lakshmi Nair',
      customerPhone: '+919847012345',
      eventType: null,
      amountPaise: 15_000_000,
      advancePaise: 5_000_000,
      notes: null,
      status: 'ACTIVE',
      cancelledAt: null,
      createdAt: '2026-11-24T00:00:00Z',
      slots: [{ eventDate: '2030-01-09', slot: 'FULL_DAY' }],
    };
    (await pending('/api/v1/owner/auditoriums/v1/offline-bookings?status=ALL')).flush({
      items: [booking],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Lakshmi Nair');
    expect(el.textContent).toContain('Balance');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Cancel booking'))!
      .click();
    expect(confirm.mock.calls[0]![0]).toContain('Lakshmi Nair');
    const cancel = await pending('/api/v1/owner/offline-bookings/o1/cancel');
    expect(cancel.request.method).toBe('POST');
    cancel.flush({ ...booking, status: 'CANCELLED', slots: [] });
    (await pending('/api/v1/owner/auditoriums/v1/offline-bookings?status=ALL')).flush({
      items: [],
    });
    confirm.mockRestore();
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
