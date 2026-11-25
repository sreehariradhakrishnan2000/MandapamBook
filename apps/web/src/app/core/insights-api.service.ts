import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  OwnerEarnings,
  PublicReview,
  ReportSummary,
  ReviewableOfflineBooking,
} from '@mandapambook/shared';
import { firstValueFrom } from 'rxjs';
import { API } from './auth/auth.service';

export interface VenueReviews {
  ratingAvg: number | null;
  ratingCount: number;
  items: PublicReview[];
}

export interface OwnerReview {
  id: string;
  venueName: string;
  rating: number;
  body: string;
  author: string;
  status: 'PUBLISHED' | 'HIDDEN' | 'FLAGGED';
  ownerReply: string | null;
  createdAt: string;
}

export interface AdminReview extends Omit<OwnerReview, 'author'> {
  customerName: string;
  customerEmail: string;
  /** Null only on reviews written before a phone number was required. */
  customerPhone: string | null;
  source: 'APP' | 'OFFLINE';
  eventDate: string;
}

export type PayoutStatus = 'PENDING' | 'SCHEDULED' | 'PAID' | 'ON_HOLD';

export interface PayoutRow {
  id: string;
  refCode: string;
  eventDate: string;
  venueName: string;
  grossPaise: number;
  commissionPaise: number;
  netPaise: number;
  status: PayoutStatus;
  reference: string | null;
  paidAt: string | null;
}

export interface ReportRange {
  from?: string;
  to?: string;
}

const params = (o: Record<string, string | number | undefined>) => {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p = p.set(k, v);
  return p;
};

/** Reviews, earnings, payouts and reports. */
@Injectable({ providedIn: 'root' })
export class InsightsApi {
  private readonly http = inject(HttpClient);

  venueReviews = (venueId: string, offset = 0) =>
    firstValueFrom(
      this.http.get<VenueReviews>(`${API}/auditoriums/${venueId}/reviews`, {
        params: params({ limit: 10, offset }),
      }),
    );

  createReview = (bookingId: string, rating: number, body: string) =>
    firstValueFrom(
      this.http.post<{ id: string }>(`${API}/bookings/${bookingId}/review`, { rating, body }),
    );

  /** Bookings venues took for me offline, matched on my verified mobile number. */
  myOfflineBookings = () =>
    firstValueFrom(
      this.http.get<{ items: ReviewableOfflineBooking[] }>(`${API}/me/offline-bookings`),
    );
  reviewOfflineBooking = (offlineBookingId: string, rating: number, body: string) =>
    firstValueFrom(
      this.http.post<{ id: string }>(`${API}/offline-bookings/${offlineBookingId}/review`, {
        rating,
        body,
      }),
    );

  ownerReviews = () =>
    firstValueFrom(this.http.get<{ items: OwnerReview[] }>(`${API}/owner/reviews`));
  reply = (id: string, reply: string) =>
    firstValueFrom(this.http.post(`${API}/owner/reviews/${id}/reply`, { reply }));

  earnings = (range: ReportRange) =>
    firstValueFrom(
      this.http.get<{ summary: OwnerEarnings; payouts: PayoutRow[] }>(`${API}/owner/earnings`, {
        params: params({ ...range }),
      }),
    );

  summary = (range: ReportRange) =>
    firstValueFrom(
      this.http.get<ReportSummary>(`${API}/admin/reports/summary`, {
        params: params({ ...range }),
      }),
    );
  csvUrl = (range: ReportRange) =>
    `${API}/admin/reports/bookings.csv?${params({ ...range }).toString()}`;

  payouts = (status?: PayoutStatus) =>
    firstValueFrom(
      this.http.get<{ items: PayoutRow[] }>(`${API}/admin/payouts`, { params: params({ status }) }),
    );
  markPaid = (id: string, reference: string) =>
    firstValueFrom(this.http.post(`${API}/admin/payouts/${id}/mark-paid`, { reference }));

  adminReviews = (status?: string) =>
    firstValueFrom(
      this.http.get<{ total: number; items: AdminReview[] }>(`${API}/admin/reviews`, {
        params: params({ status, limit: 50 }),
      }),
    );
  moderate = (id: string, status: 'PUBLISHED' | 'HIDDEN', reason: string) =>
    firstValueFrom(this.http.patch(`${API}/admin/reviews/${id}`, { status, reason }));
}
