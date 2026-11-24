import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  QuoteRequest,
  QuoteView,
  SearchQuery,
  SearchResult,
  Slot,
} from '@mandapambook/shared';
import { firstValueFrom } from 'rxjs';
import { API } from './auth/auth.service';
import type { CancellationTier } from './owner-api.service';

export interface VenuePage {
  id: string;
  slug: string;
  name: string;
  description: string;
  addressLine: string;
  locality: string | null;
  pincode: string;
  city: string;
  citySlug: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  hostedBy: string;
  cateringPolicy: string;
  decorationPolicy: string;
  parkingCars: number;
  parkingTwoWheelers: number;
  guestRooms: number;
  hasGenerator: boolean;
  sadyaPrepArea: boolean;
  cookingEquipment: boolean;
  advancePercent: number;
  instantBook: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  halls: {
    id: string;
    name: string;
    seatingCapacity: number;
    diningCapacity: number;
    isAc: boolean;
    diningIsAc: boolean;
    basePrices: Partial<Record<Slot, number>>;
  }[];
  amenities: { code: string; name: string }[];
  addons: {
    id: string;
    code: string;
    name: string;
    description: string;
    unit: string;
    pricePaise: number;
    maxQuantity: number;
  }[];
  cancellationPolicy: { tiers: CancellationTier[]; notes: string } | null;
  photos: { url: string; altText: string }[];
}

export interface Availability {
  month: string;
  halls: { hallId: string; name: string; taken: Record<string, Slot[]> }[];
}

export interface HoldResponse {
  id: string;
  refCode: string;
  status: string;
  holdExpiresAt: string;
  quote: QuoteView;
}

export type BookingStatus =
  | 'HELD'
  | 'PENDING_PAYMENT'
  | 'AWAITING_OWNER'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED';

export interface BookingSummary {
  id: string;
  refCode: string;
  status: BookingStatus;
  eventDate: string;
  slot: Slot;
  guestCount: number;
  holdExpiresAt: string | null;
  totalPaise: number;
  advancePaise: number;
  refundDuePaise: number | null;
  venueName: string;
  venueSlug: string;
  hallName: string;
  city: string;
  createdAt: string;
}

export interface BookingDetail extends BookingSummary {
  addressLine: string;
  pincode: string;
  subtotalPaise: number;
  addonsPaise: number;
  gstPaise: number;
  platformFeePaise: number;
  cancellationTiers: CancellationTier[];
  history: { toStatus: BookingStatus; at: string }[];
  review: { id: string; rating: number } | null;
}

export interface RefundPreview {
  daysBeforeEvent: number;
  refundPercent: number;
  refundPaise: number;
  retainedPaise: number;
  rule: string;
}

export interface OwnerBooking extends BookingSummary {
  customer: { name: string; phone: string | null; email: string } | null;
}

function toParams(query: Record<string, unknown>): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p = p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return p;
}

@Injectable({ providedIn: 'root' })
export class BookingApi {
  private readonly http = inject(HttpClient);

  cities = () =>
    firstValueFrom(
      this.http.get<{ items: { id: string; name: string; slug: string; state: string }[] }>(
        `${API}/cities`,
      ),
    );
  amenities = () =>
    firstValueFrom(this.http.get<{ items: { code: string; name: string }[] }>(`${API}/amenities`));

  search = (q: SearchQuery) =>
    firstValueFrom(
      this.http.get<{ items: SearchResult[]; total: number; page: number; pageSize: number }>(
        `${API}/auditoriums`,
        { params: toParams(q) },
      ),
    );
  venue = (slug: string) =>
    firstValueFrom(this.http.get<VenuePage>(`${API}/auditoriums/${encodeURIComponent(slug)}`));
  availability = (venueId: string, month: string) =>
    firstValueFrom(
      this.http.get<Availability>(`${API}/auditoriums/${venueId}/availability`, {
        params: { month },
      }),
    );

  quote = (req: QuoteRequest) =>
    firstValueFrom(this.http.post<QuoteView>(`${API}/bookings/quote`, req));
  hold = (req: QuoteRequest) =>
    firstValueFrom(this.http.post<HoldResponse>(`${API}/bookings`, req));

  mine = () => firstValueFrom(this.http.get<{ items: BookingSummary[] }>(`${API}/bookings/mine`));
  booking = (id: string) => firstValueFrom(this.http.get<BookingDetail>(`${API}/bookings/${id}`));
  cancelPreview = (id: string) =>
    firstValueFrom(this.http.get<RefundPreview>(`${API}/bookings/${id}/cancel-preview`));
  cancel = (id: string, reason?: string) =>
    firstValueFrom(
      this.http.post<{ status: BookingStatus; refund: RefundPreview }>(
        `${API}/bookings/${id}/cancel`,
        reason ? { reason } : {},
      ),
    );

  ownerBookings = (status?: BookingStatus) =>
    firstValueFrom(
      this.http.get<{ items: OwnerBooking[] }>(`${API}/owner/bookings`, {
        params: toParams({ status }),
      }),
    );
  accept = (id: string) =>
    firstValueFrom(
      this.http.post<{ status: BookingStatus }>(`${API}/owner/bookings/${id}/accept`, null),
    );
  balanceReceived = (id: string) =>
    firstValueFrom(this.http.post(`${API}/owner/bookings/${id}/balance-received`, null));
}

export const SLOT_LABELS: Record<Slot, string> = {
  MORNING: 'Muhurtham (morning)',
  EVENING: 'Reception (evening)',
  FULL_DAY: 'Full day',
};

export const STATUS_LABELS: Record<BookingStatus, string> = {
  HELD: 'On hold',
  PENDING_PAYMENT: 'Awaiting payment',
  AWAITING_OWNER: 'Waiting for venue',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  REFUNDED: 'Refunded',
};
