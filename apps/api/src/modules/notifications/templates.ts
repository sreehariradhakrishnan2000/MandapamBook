import { formatInr } from '@mandapambook/shared';

/** Variables a booking notification may use. Nothing here is secret or payment-sensitive. */
export interface BookingNotificationData {
  bookingId: string;
  refCode: string;
  venueName: string;
  hallName: string;
  eventDate: string;
  slot: string;
  totalPaise: number;
  paidPaise: number;
  refundPaise: number;
  recipientName: string;
  customerName?: string;
}

export type BookingTemplate =
  | 'booking_confirmed'
  | 'booking_requested'
  | 'booking_declined'
  | 'booking_cancelled'
  | 'refund_processed'
  | 'hold_expired'
  | 'review_request'
  | 'owner_new_booking'
  | 'owner_request_pending'
  | 'owner_booking_cancelled';

const SLOT: Record<string, string> = {
  MORNING: 'Muhurtham (morning)',
  EVENING: 'Reception (evening)',
  FULL_DAY: 'Full day',
};

function when(d: BookingNotificationData): string {
  const date = new Date(`${d.eventDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${date}, ${SLOT[d.slot] ?? d.slot}`;
}

/** Plain-text emails: they render everywhere and cannot carry tracking or script. */
export function renderBookingEmail(
  template: BookingTemplate,
  d: BookingNotificationData,
  appBaseUrl: string,
): { subject: string; text: string } {
  const link = `${appBaseUrl}/account/bookings/${d.bookingId}`;
  const ownerLink = `${appBaseUrl}/owner/bookings`;
  const hi = `Hi ${d.recipientName},`;
  const what = `${d.venueName} (${d.hallName}) on ${when(d)}`;
  const sign = '\n\nMandapamBook';
  switch (template) {
    case 'booking_confirmed':
      return {
        subject: `Booking confirmed: ${d.venueName}, ${d.eventDate} (${d.refCode})`,
        text: `${hi}\n\nYour booking for ${what} is confirmed.\nReference: ${d.refCode}\nPaid online: ${formatInr(d.paidPaise)} of ${formatInr(d.totalPaise)}. The balance is paid at the venue.\n\nYour invoice is attached. Booking details: ${link}${sign}`,
      };
    case 'booking_requested':
      return {
        subject: `Request sent to ${d.venueName} (${d.refCode})`,
        text: `${hi}\n\nWe received your payment of ${formatInr(d.paidPaise)} for ${what}. The venue confirms each request and has 24 hours to reply. If they decline or do not reply, you get a full refund automatically.\n\n${link}${sign}`,
      };
    case 'booking_declined':
      return {
        subject: `${d.venueName} could not take your booking (${d.refCode})`,
        text: `${hi}\n\nThe venue could not accept your request for ${what}. We are refunding ${formatInr(d.refundPaise)} to your original payment method; banks usually take 5-7 working days.\n\nSearch for another hall: ${appBaseUrl}/search${sign}`,
      };
    case 'booking_cancelled':
      return {
        subject: `Booking cancelled (${d.refCode})`,
        text: `${hi}\n\nYour booking for ${what} is cancelled.${d.refundPaise > 0 ? ` A refund of ${formatInr(d.refundPaise)} is on its way.` : ''}\n\n${link}${sign}`,
      };
    case 'refund_processed':
      return {
        subject: `Refund processed (${d.refCode})`,
        text: `${hi}\n\nWe have refunded ${formatInr(d.refundPaise)} for ${what}. It should reach your account in 5-7 working days.\n\n${link}${sign}`,
      };
    case 'hold_expired':
      return {
        subject: `Your hold on ${d.venueName} expired`,
        text: `${hi}\n\nThe hold on ${what} expired before payment was completed, so the date was released. If any money left your account, it is refunded automatically.\n\nTry again: ${appBaseUrl}/search${sign}`,
      };
    case 'review_request':
      return {
        subject: `How was ${d.venueName}?`,
        text: `${hi}\n\nWe hope your event on ${d.eventDate} went beautifully. A short review helps other families choose: ${link}${sign}`,
      };
    case 'owner_new_booking':
      return {
        subject: `New booking: ${d.eventDate} (${d.refCode})`,
        text: `${hi}\n\n${d.customerName ?? 'A customer'} booked ${what}.\nAdvance paid online: ${formatInr(d.paidPaise)}. Balance due at the venue: ${formatInr(Math.max(0, d.totalPaise - d.paidPaise))}.\n\n${ownerLink}${sign}`,
      };
    case 'owner_request_pending':
      return {
        subject: `Action needed: booking request for ${d.eventDate} (${d.refCode})`,
        text: `${hi}\n\n${d.customerName ?? 'A customer'} has paid ${formatInr(d.paidPaise)} to book ${what}. Accept or decline within 24 hours, or the request is declined and refunded automatically.\n\n${ownerLink}${sign}`,
      };
    case 'owner_booking_cancelled':
      return {
        subject: `Booking cancelled: ${d.eventDate} (${d.refCode})`,
        text: `${hi}\n\nThe booking for ${what} was cancelled and the date is open again.\n\n${ownerLink}${sign}`,
      };
  }
}
