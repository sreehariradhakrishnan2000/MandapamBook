import { describe, expect, it } from 'vitest';
import {
  backoffMinutes,
  notificationsFor,
} from '../../src/modules/notifications/notification.service.js';
import {
  type BookingNotificationData,
  type BookingTemplate,
  renderBookingEmail,
} from '../../src/modules/notifications/templates.js';

const t = (fromStatus: string | null, toStatus: string, reason: string | null = null) =>
  notificationsFor({ fromStatus, toStatus, reason } as never, 'cust', 'own').map(
    (r) => `${r.userId}:${r.template}`,
  );

describe('notificationsFor', () => {
  it('maps booking transitions to recipients', () => {
    expect(t('PENDING_PAYMENT', 'CONFIRMED')).toEqual([
      'cust:booking_confirmed',
      'own:owner_new_booking',
    ]);
    expect(t('AWAITING_OWNER', 'CONFIRMED')).toEqual([
      'cust:booking_confirmed',
      'own:owner_new_booking',
    ]);
    expect(t('PENDING_PAYMENT', 'AWAITING_OWNER')).toEqual([
      'cust:booking_requested',
      'own:owner_request_pending',
    ]);
    expect(t('AWAITING_OWNER', 'CANCELLED', 'rejected_by_owner')).toEqual([
      'cust:booking_declined',
    ]);
    expect(t('AWAITING_OWNER', 'CANCELLED', 'owner_response_timeout')).toEqual([
      'cust:booking_declined',
    ]);
    expect(t('CONFIRMED', 'CANCELLED', 'customer')).toEqual([
      'cust:booking_cancelled',
      'own:owner_booking_cancelled',
    ]);
    expect(t('HELD', 'CANCELLED')).toEqual(['cust:booking_cancelled']);
    expect(t('CANCELLED', 'REFUNDED')).toEqual(['cust:refund_processed']);
    expect(t('PENDING_PAYMENT', 'EXPIRED')).toEqual(['cust:hold_expired']);
    expect(t('HELD', 'EXPIRED')).toEqual([]);
    expect(t('CONFIRMED', 'COMPLETED')).toEqual(['cust:review_request']);
    expect(t(null, 'HELD')).toEqual([]);
    expect(t('HELD', 'PENDING_PAYMENT')).toEqual([]);
  });

  it('backs off exponentially up to an hour', () => {
    expect([1, 2, 3, 4, 5, 8, 20].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16, 60, 60]);
  });
});

describe('booking email templates', () => {
  const data: BookingNotificationData = {
    bookingId: 'b1',
    refCode: 'MB-ABC123',
    venueName: 'Guruvayur Mahal',
    hallName: 'Main Hall',
    eventDate: '2027-02-10',
    slot: 'MORNING',
    totalPaise: 15_000_000,
    paidPaise: 3_800_000,
    refundPaise: 1_000_000,
    recipientName: 'Anu',
  };
  const all: BookingTemplate[] = [
    'booking_confirmed',
    'booking_requested',
    'booking_declined',
    'booking_cancelled',
    'refund_processed',
    'hold_expired',
    'review_request',
    'owner_new_booking',
    'owner_request_pending',
    'owner_booking_cancelled',
  ];

  it('renders every template with INR amounts and a link', () => {
    for (const template of all) {
      const { subject, text } = renderBookingEmail(template, data, 'https://mandapambook.in');
      expect(subject.length).toBeGreaterThan(5);
      expect(text).toMatch(/^Hi Anu,/);
      expect(text).toContain('https://mandapambook.in/');
    }
    const confirmed = renderBookingEmail('booking_confirmed', data, 'https://m.in');
    expect(confirmed.text).toContain('₹38,000');
    expect(confirmed.text).toContain('₹1,50,000');
    expect(confirmed.text).toContain('Muhurtham (morning)');
    expect(renderBookingEmail('owner_new_booking', data, 'https://m.in').text).toContain(
      '₹1,12,000',
    );
    expect(
      renderBookingEmail('booking_cancelled', { ...data, refundPaise: 0 }, 'https://m.in').text,
    ).not.toContain('refund');
  });
});
