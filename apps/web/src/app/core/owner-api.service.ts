import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AuditoriumInput,
  OwnerProfileInput,
  OwnerProfileView,
  Slot,
} from '@mandapambook/shared';
import { firstValueFrom } from 'rxjs';
import { API } from './auth/auth.service';

export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface VenueSummary {
  id: string;
  name: string;
  slug: string;
  status: ListingStatus;
  cityId: string;
  rejectionReason: string | null;
  updatedAt: string;
}

export interface Hall {
  id: string;
  name: string;
  seatingCapacity: number;
  diningCapacity: number;
  isAc: boolean;
  isActive: boolean;
}

export interface Addon {
  id: string;
  code: string;
  name: string;
  unit: 'PER_EVENT' | 'PER_ROOM' | 'PER_HOUR';
  pricePaise: number;
  maxQuantity: number;
  isActive: boolean;
}

export interface Photo {
  id: string;
  status: 'PENDING_UPLOAD' | 'READY' | 'REJECTED';
  altText: string;
  sortOrder: number;
  url: string | null;
}

export interface CancellationTier {
  minDaysBefore: number;
  refundPercent: number;
}

export interface VenueDetail
  extends VenueSummary, Required<Omit<AuditoriumInput, 'locality' | 'latitude' | 'longitude'>> {
  locality: string | null;
  latitude: number | null;
  longitude: number | null;
  halls: Hall[];
  amenities: { code: string; name: string }[];
  addons: Addon[];
  cancellationPolicy: { tiers: CancellationTier[]; notes: string } | null;
  photos: Photo[];
}

export interface PricingRule {
  id: string;
  slot: Slot;
  kind: 'BASE' | 'WEEKEND' | 'SEASONAL' | 'MUHURTHAM' | 'DATE_OVERRIDE';
  validFrom: string | null;
  validTo: string | null;
  pricePaise: number;
  priority: number;
  label: string | null;
}

export interface CalendarEntry {
  eventDate: string;
  slot: Slot;
  kind: 'BLOCK' | 'BOOKING';
  blockId: string | null;
  reason: string | null;
}

export interface City {
  id: string;
  name: string;
  district: string;
  state: string;
}

export interface Amenity {
  code: string;
  name: string;
}

export interface StaffMember {
  userId: string;
  email: string;
  fullName: string;
  status: string;
  auditoriumIds: string[];
}

/** Typed wrapper over the owner API. Components never build URLs themselves. */
@Injectable({ providedIn: 'root' })
export class OwnerApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${API}/owner`;

  private get<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  private send<T>(
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return firstValueFrom(this.http.request<T>(method, `${this.base}${path}`, { body }));
  }

  cities = () => firstValueFrom(this.http.get<{ items: City[] }>(`${API}/cities`));
  amenities = () => firstValueFrom(this.http.get<{ items: Amenity[] }>(`${API}/amenities`));

  profile = () => this.get<OwnerProfileView>('/profile');
  saveProfile = (input: OwnerProfileInput) => this.send<OwnerProfileView>('put', '/profile', input);

  venues = () => this.get<{ items: VenueSummary[] }>('/auditoriums');
  venue = (id: string) => this.get<VenueDetail>(`/auditoriums/${id}`);
  createVenue = (input: AuditoriumInput) => this.send<VenueSummary>('post', '/auditoriums', input);
  updateVenue = (id: string, input: Partial<AuditoriumInput>) =>
    this.send<VenueDetail>('patch', `/auditoriums/${id}`, input);
  deleteVenue = (id: string) => this.send<unknown>('delete', `/auditoriums/${id}`);
  submitVenue = (id: string) => this.send<VenueSummary>('post', `/auditoriums/${id}/submit`);
  setAmenities = (id: string, codes: string[]) =>
    this.send('put', `/auditoriums/${id}/amenities`, { codes });
  setPolicy = (id: string, tiers: CancellationTier[], notes: string) =>
    this.send('put', `/auditoriums/${id}/cancellation-policy`, { tiers, notes });

  addHall = (venueId: string, input: Omit<Hall, 'id' | 'isActive'>) =>
    this.send<Hall>('post', `/auditoriums/${venueId}/halls`, input);
  updateHall = (hallId: string, input: Partial<Hall>) =>
    this.send<Hall>('patch', `/halls/${hallId}`, input);
  removeHall = (hallId: string) => this.send<unknown>('delete', `/halls/${hallId}`);

  pricingRules = (hallId: string) =>
    this.get<{ items: PricingRule[] }>(`/halls/${hallId}/pricing-rules`);
  addPricingRule = (
    hallId: string,
    input: Omit<PricingRule, 'id' | 'priority' | 'label' | 'validFrom' | 'validTo'> & {
      validFrom?: string;
      validTo?: string;
      label?: string;
    },
  ) => this.send<PricingRule>('post', `/halls/${hallId}/pricing-rules`, input);
  removePricingRule = (ruleId: string) => this.send<unknown>('delete', `/pricing-rules/${ruleId}`);

  calendar = (hallId: string, from: string, to: string) =>
    this.get<{ items: CalendarEntry[] }>(`/halls/${hallId}/calendar?from=${from}&to=${to}`);
  block = (hallId: string, eventDate: string, slot: Slot, reason?: string) =>
    this.send(
      'post',
      `/halls/${hallId}/blocks`,
      reason ? { eventDate, slot, reason } : { eventDate, slot },
    );
  unblock = (blockId: string) => this.send<unknown>('delete', `/blocks/${blockId}`);

  addAddon = (venueId: string, input: Omit<Addon, 'id' | 'isActive'>) =>
    this.send<Addon>('post', `/auditoriums/${venueId}/addons`, input);
  removeAddon = (addonId: string) => this.send<unknown>('delete', `/addons/${addonId}`);

  /**
   * Two-step upload: get a presigned URL from our API, PUT the file straight to storage
   * (no auth header leaves our origin: the interceptor only touches /api/v1), then ask the
   * API to verify what arrived.
   */
  async uploadPhoto(venueId: string, file: File, altText: string): Promise<void> {
    const { mediaId, upload } = await this.send<{
      mediaId: string;
      upload: { url: string; method: 'PUT'; headers: Record<string, string> };
    }>('post', `/auditoriums/${venueId}/media/upload-url`, {
      mimeType: file.type,
      sizeBytes: file.size,
      altText,
    });
    // Content-Length is set by the browser from the body; only Content-Type is sent explicitly.
    await firstValueFrom(
      this.http.put(upload.url, file, {
        headers: { 'Content-Type': upload.headers['Content-Type'] ?? file.type },
      }),
    );
    await this.send('post', `/media/${mediaId}/confirm`);
  }
  removePhoto = (mediaId: string) => this.send<unknown>('delete', `/media/${mediaId}`);

  staff = () => this.get<{ items: StaffMember[] }>('/staff');
  inviteStaff = (email: string, fullName: string, auditoriumIds: string[]) =>
    this.send<StaffMember>('post', '/staff', { email, fullName, auditoriumIds });
  removeStaff = (userId: string) => this.send<unknown>('delete', `/staff/${userId}`);
}
