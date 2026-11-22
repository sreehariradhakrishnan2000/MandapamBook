import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { type AuthSession, type QuoteView, permissionsFor } from '@mandapambook/shared';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import type { VenuePage } from '../../core/booking-api.service';
import { Search } from '../public/search';
import { Book } from './book';

const venue: VenuePage = {
  id: 'v1',
  slug: 'sundaram-mahal',
  name: 'Sundaram Thirumana Mahal',
  description: '',
  addressLine: '22 Kutchery Road',
  locality: 'Mylapore',
  pincode: '600004',
  city: 'Chennai',
  citySlug: 'chennai',
  state: 'Tamil Nadu',
  latitude: null,
  longitude: null,
  hostedBy: 'Sundaram Mahal Group',
  cateringPolicy: 'IN_HOUSE_ONLY',
  decorationPolicy: 'OUTSIDE_ALLOWED',
  parkingCars: 60,
  parkingTwoWheelers: 120,
  guestRooms: 12,
  hasGenerator: true,
  advancePercent: 25,
  instantBook: true,
  ratingAvg: null,
  ratingCount: 0,
  halls: [
    {
      id: 'h1',
      name: 'Mahal',
      seatingCapacity: 800,
      diningCapacity: 400,
      isAc: true,
      basePrices: { MORNING: 12_000_000 },
    },
  ],
  amenities: [],
  addons: [],
  cancellationPolicy: null,
  photos: [],
};

const quote: QuoteView = {
  hallId: 'h1',
  eventDate: '2030-01-09',
  slot: 'MORNING',
  ruleKind: 'BASE',
  basePaise: 12_000_000,
  addons: [],
  addonsPaise: 0,
  venueChargesPaise: 12_000_000,
  gstPaise: 2_160_000,
  gstBasisPoints: 1800,
  platformFeePaise: 49_900,
  totalPaise: 14_209_900,
  payNowPaise: 3_589_900,
  payLaterPaise: 10_620_000,
  advancePercent: 25,
  available: true,
};

describe('booking flow', () => {
  let http: HttpTestingController;
  const pending = (url: string) => vi.waitFor(() => http.expectOne((r) => r.url === url));
  const find = (root: HTMLElement, text: string) =>
    vi.waitFor(() => {
      const el = [...root.querySelectorAll('button, a')].find((e) => e.textContent?.includes(text));
      if (!el) throw new Error(`no element with "${text}"`);
      return el as HTMLElement;
    });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function bookPage() {
    const fixture = TestBed.createComponent(Book);
    fixture.componentRef.setInput('hallId', 'h1');
    fixture.componentRef.setInput('slug', 'sundaram-mahal');
    fixture.componentRef.setInput('date', '2030-01-09');
    fixture.componentRef.setInput('slot', 'MORNING');
    fixture.componentRef.setInput('guests', '500');
    fixture.detectChanges();
    (await pending('/api/v1/auditoriums/sundaram-mahal')).flush(venue);
    const q = await pending('/api/v1/bookings/quote');
    expect(q.request.body).toEqual({
      hallId: 'h1',
      eventDate: '2030-01-09',
      slot: 'MORNING',
      guestCount: 500,
      addons: [],
    });
    q.flush(quote);
    await fixture.whenStable();
    return fixture;
  }

  it('shows the server price breakdown with what is paid now and later', async () => {
    const fixture = await bookPage();
    const el = fixture.nativeElement as HTMLElement;
    await find(el, 'Sign in to hold this date');
    expect(el.textContent).toContain('₹1,42,099.00');
    expect(el.textContent).toContain('₹35,899.00');
    expect(el.textContent).toContain('₹1,06,200.00');
  });

  it('sends signed-out visitors to sign in instead of holding', async () => {
    const fixture = await bookPage();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (await find(fixture.nativeElement as HTMLElement, 'Sign in to hold')).click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/login'], expect.anything()));
    http.expectNone('/api/v1/bookings');
  });

  it('holds the slot for a signed-in customer and shows a countdown', async () => {
    const session: AuthSession = {
      accessToken: 't',
      expiresIn: 900,
      user: {
        id: 'c1',
        email: 'c@example.test',
        fullName: 'Priya',
        phone: null,
        role: 'CUSTOMER',
        emailVerified: true,
        phoneVerified: false,
        permissions: permissionsFor('CUSTOMER'),
      },
    };
    const login = TestBed.inject(AuthService).login('c@example.test', 'pw', false);
    http.expectOne('/api/v1/auth/login').flush(session);
    await login;

    const fixture = await bookPage();
    (await find(fixture.nativeElement as HTMLElement, 'Hold this date')).click();
    const hold = await pending('/api/v1/bookings');
    expect(hold.request.headers.get('Authorization')).toBe('Bearer t');
    hold.flush({
      id: 'b1',
      refCode: 'MB-7K3Q9X',
      status: 'HELD',
      holdExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      quote,
    });
    await vi.waitFor(() =>
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('MB-7K3Q9X'),
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toMatch(/(9|10):\d\d/);
  });
});

describe('search page', () => {
  it('turns the URL budget in rupees into a paise filter', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Search);
    fixture.componentRef.setInput('city', 'chennai');
    fixture.componentRef.setInput('date', '2030-01-09');
    fixture.componentRef.setInput('guests', '500');
    fixture.componentRef.setInput('budget', '150000');
    fixture.detectChanges();
    const req = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/v1/auditoriums'));
    expect(req.request.params.get('maxPricePaise')).toBe('15000000');
    expect(req.request.params.get('city')).toBe('chennai');
    expect(req.request.params.get('guests')).toBe('500');
    req.flush({ items: [], total: 0, page: 1, pageSize: 12 });
    http.match(() => true).forEach((r) => r.flush({ items: [] }));
  });
});
