import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API } from './auth/auth.service';
import type { BookingStatus } from './booking-api.service';

export interface PaymentConfig {
  provider: 'mock' | 'razorpay';
  testMode: boolean;
}

export interface PaymentOrder {
  paymentId: string;
  provider: string;
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  checkout: Record<string, string>;
  testMode: boolean;
}

export interface PaymentStatus {
  id: string;
  status: 'CREATED' | 'PENDING' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  bookingId: string;
  bookingStatus: BookingStatus;
  refCode: string;
}

/** Talks only to our /payments API; gateway specifics live in PaymentAdapter. */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly http = inject(HttpClient);
  readonly config = signal<PaymentConfig | null>(null);

  async loadConfig(): Promise<void> {
    try {
      this.config.set(await firstValueFrom(this.http.get<PaymentConfig>(`${API}/payments/config`)));
    } catch {
      this.config.set(null);
    }
  }

  /** One key per pay attempt, so a double click or retry never creates a second order. */
  createOrder(bookingId: string, idempotencyKey: string): Promise<PaymentOrder> {
    return firstValueFrom(
      this.http.post<PaymentOrder>(
        `${API}/payments/orders`,
        { bookingId },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    );
  }

  verify(input: {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): Promise<PaymentStatus> {
    return firstValueFrom(this.http.post<PaymentStatus>(`${API}/payments/verify`, input));
  }
}
