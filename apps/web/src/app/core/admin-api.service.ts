import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  ListingDecision,
  OwnerProfileView,
  PlatformSettings,
  Role,
} from '@mandapambook/shared';
import { firstValueFrom } from 'rxjs';
import { API } from './auth/auth.service';
import type { CancellationTier, ListingStatus } from './owner-api.service';

export interface Page<T> {
  items: T[];
  total: number;
}

export interface QueueItem {
  id: string;
  name: string;
  status: ListingStatus;
  city: string;
  ownerName: string;
  ownerEmail: string;
  kycStatus: OwnerProfileView['kycStatus'];
  updatedAt: string;
}

export interface ReviewDetail {
  id: string;
  name: string;
  status: ListingStatus;
  city: string;
  description: string;
  addressLine: string;
  pincode: string;
  cateringPolicy: string;
  decorationPolicy: string;
  advancePercent: number;
  instantBook: boolean;
  rejectionReason: string | null;
  owner: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    businessName: string;
    kycStatus: OwnerProfileView['kycStatus'];
  };
  halls: {
    id: string;
    name: string;
    seatingCapacity: number;
    isAc: boolean;
    pricingRules: { slot: string; kind: string; pricePaise: number }[];
  }[];
  amenities: { code: string; name: string }[];
  cancellationPolicy: { tiers: CancellationTier[] } | null;
  photos: { id: string; url: string | null; altText: string }[];
  gaps: string[];
}

export interface OwnerKycItem extends OwnerProfileView {
  ownerId: string;
  email: string;
  fullName: string;
  updatedAt: string;
}

export interface RevealedKyc {
  pan: string;
  bankAccountNumber: string;
  ifsc: string | null;
  gstin: string | null;
  bankAccountName: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

export interface CityRow {
  id: string;
  name: string;
  slug: string;
  district: string;
  state: string;
  isActive: boolean;
}

export interface AmenityRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorRole: Role | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  success: boolean;
  createdAt: string;
}

function params(query: Record<string, string | number | undefined>): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== '') p = p.set(k, String(v));
  return p;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${API}/admin`;

  private get<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params: params(query) }));
  }
  private send<T>(
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return firstValueFrom(this.http.request<T>(method, `${this.base}${path}`, { body }));
  }

  listings = (status: ListingStatus, q?: string, offset = 0) =>
    this.get<Page<QueueItem>>('/listings', { status, q, offset });
  listing = (id: string) => this.get<ReviewDetail>(`/listings/${id}`);
  decide = (id: string, decision: ListingDecision) =>
    this.send<{ status: ListingStatus }>('post', `/listings/${id}/decision`, decision);

  owners = (kycStatus?: string, q?: string) =>
    this.get<Page<OwnerKycItem>>('/owners', { kycStatus, q });
  revealKyc = (ownerId: string, purpose: string) =>
    this.send<RevealedKyc>('post', `/owners/${ownerId}/kyc/reveal`, { purpose });
  decideKyc = (
    ownerId: string,
    decision: { decision: 'verify' } | { decision: 'reject'; reason: string },
  ) => this.send<OwnerProfileView>('post', `/owners/${ownerId}/kyc/decision`, decision);

  users = (query: { q?: string; role?: string; status?: string; offset?: number }) =>
    this.get<Page<AdminUser>>('/users', query);
  changeRole = (id: string, role: Role) =>
    this.send<{ role: Role }>('patch', `/users/${id}/role`, { role });
  changeStatus = (id: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) =>
    this.send<unknown>('patch', `/users/${id}/status`, { status, reason });

  cities = () => this.get<{ items: CityRow[] }>('/cities');
  addCity = (input: Omit<CityRow, 'id' | 'isActive'>) =>
    this.send<CityRow>('post', '/cities', input);
  setCityActive = (id: string, isActive: boolean) =>
    this.send<CityRow>('patch', `/cities/${id}`, { isActive });
  amenities = () => this.get<{ items: AmenityRow[] }>('/amenities');
  addAmenity = (code: string, name: string) =>
    this.send<AmenityRow>('post', '/amenities', { code, name });
  setAmenityActive = (id: string, isActive: boolean) =>
    this.send<AmenityRow>('patch', `/amenities/${id}`, { isActive });
  muhurthamDates = () =>
    this.get<{ items: { date: string; label: string | null }[] }>('/muhurtham-dates');
  addMuhurtham = (date: string, label?: string) =>
    this.send<unknown>('post', '/muhurtham-dates', label ? { date, label } : { date });
  removeMuhurtham = (date: string) => this.send<unknown>('delete', `/muhurtham-dates/${date}`);

  settings = () => this.get<PlatformSettings>('/settings');
  updateSettings = (changes: Partial<PlatformSettings>) =>
    this.send<PlatformSettings>('put', '/settings', changes);

  auditLogs = (query: {
    action?: string;
    entityType?: string;
    entityId?: string;
    before?: string;
  }) => this.get<{ items: AuditRow[]; nextBefore: string | null }>('/audit-logs', query);
}
