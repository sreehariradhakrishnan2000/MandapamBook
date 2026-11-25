import { formatInr } from '@mandapambook/shared';
import { type EmailContent, type RenderedEmail, renderEmail } from './email-layout.js';

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
  /** Admin copies only: the booking's new status and the reason given, if any. */
  toStatus?: string;
  reason?: string | null;
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
  | 'owner_booking_cancelled'
  | 'admin_booking_alert';

const ADMIN_HEADINGS: Record<string, { subject: string; heading: string }> = {
  CONFIRMED: { subject: 'New booking', heading: 'New booking confirmed' },
  AWAITING_OWNER: {
    subject: 'New booking request',
    heading: 'New booking request, waiting for the venue',
  },
  CANCELLED: { subject: 'Booking cancelled', heading: 'A booking was cancelled' },
  REFUNDED: { subject: 'Refund processed', heading: 'A refund was processed' },
};

const REASONS: Record<string, string> = {
  rejected_by_owner: 'Declined by the venue',
  owner_response_timeout: 'The venue did not answer in time',
};

const SLOT: Record<string, string> = {
  MORNING: 'Muhurtham (morning)',
  EVENING: 'Reception (evening)',
  FULL_DAY: 'Full day',
};

function longDate(d: BookingNotificationData): string {
  return new Date(`${d.eventDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function when(d: BookingNotificationData): string {
  return `${longDate(d)}, ${SLOT[d.slot] ?? d.slot}`;
}

/** The facts every booking email repeats, as a details box. */
function bookingDetails(d: BookingNotificationData) {
  return [
    { label: 'Venue', value: `${d.venueName}, ${d.hallName}` },
    { label: 'Date', value: longDate(d) },
    { label: 'Slot', value: SLOT[d.slot] ?? d.slot },
    { label: 'Reference', value: d.refCode },
  ];
}

/** Booking emails in the site's design, with a plain-text version alongside. */
export function renderBookingEmail(
  template: BookingTemplate,
  d: BookingNotificationData,
  appBaseUrl: string,
): RenderedEmail {
  return renderEmail(bookingContent(template, d, appBaseUrl), appBaseUrl);
}

function bookingContent(
  template: BookingTemplate,
  d: BookingNotificationData,
  appBaseUrl: string,
): EmailContent {
  const viewBooking = {
    label: 'View your booking',
    url: `${appBaseUrl}/account/bookings/${d.bookingId}`,
  };
  const ownerBookings = { label: 'Open your bookings', url: `${appBaseUrl}/owner/bookings` };
  const search = { label: 'Find another hall', url: `${appBaseUrl}/search` };
  const what = `${d.venueName} (${d.hallName}) on ${when(d)}`;
  const greetingName = d.recipientName;
  const details = bookingDetails(d);
  const balance = Math.max(0, d.totalPaise - d.paidPaise);

  switch (template) {
    case 'booking_confirmed':
      return {
        subject: `Booking confirmed: ${d.venueName}, ${d.eventDate} (${d.refCode})`,
        heading: 'Your booking is confirmed',
        greetingName,
        paragraphs: [`Your booking for ${what} is confirmed.`],
        details: [
          ...details,
          {
            label: 'Paid online',
            value: `${formatInr(d.paidPaise)} of ${formatInr(d.totalPaise)}`,
          },
          { label: 'Balance at the venue', value: formatInr(balance) },
        ],
        action: viewBooking,
        afterAction: ['Your invoice is attached to this email.'],
      };
    case 'booking_requested':
      return {
        subject: `Request sent to ${d.venueName} (${d.refCode})`,
        heading: 'Your request is with the venue',
        greetingName,
        paragraphs: [
          `We received your payment of ${formatInr(d.paidPaise)} for ${what}.`,
          'The venue confirms each request and has 24 hours to reply. If they decline or do not reply, you get a full refund automatically.',
        ],
        details: [...details, { label: 'Paid', value: formatInr(d.paidPaise) }],
        action: viewBooking,
      };
    case 'booking_declined':
      return {
        subject: `${d.venueName} could not take your booking (${d.refCode})`,
        heading: 'The venue could not take your booking',
        greetingName,
        paragraphs: [
          `The venue could not accept your request for ${what}.`,
          `We are refunding ${formatInr(d.refundPaise)} to your original payment method; banks usually take 5-7 working days.`,
        ],
        details: [...details, { label: 'Refund', value: formatInr(d.refundPaise) }],
        action: search,
      };
    case 'booking_cancelled':
      return {
        subject: `Booking cancelled (${d.refCode})`,
        heading: 'Your booking is cancelled',
        greetingName,
        paragraphs: [
          `Your booking for ${what} is cancelled.`,
          ...(d.refundPaise > 0 ? [`A refund of ${formatInr(d.refundPaise)} is on its way.`] : []),
        ],
        details: [
          ...details,
          ...(d.refundPaise > 0 ? [{ label: 'Refund', value: formatInr(d.refundPaise) }] : []),
        ],
        action: viewBooking,
      };
    case 'refund_processed':
      return {
        subject: `Refund processed (${d.refCode})`,
        heading: 'Your refund is on its way',
        greetingName,
        paragraphs: [
          `We have refunded ${formatInr(d.refundPaise)} for ${what}. It should reach your account in 5-7 working days.`,
        ],
        details: [...details, { label: 'Refund', value: formatInr(d.refundPaise) }],
        action: viewBooking,
      };
    case 'hold_expired':
      return {
        subject: `Your hold on ${d.venueName} expired`,
        heading: 'Your hold has expired',
        greetingName,
        paragraphs: [
          `The hold on ${what} expired before payment was completed, so the date was released.`,
          'If any money left your account, it is refunded automatically.',
        ],
        details,
        action: { label: 'Search again', url: `${appBaseUrl}/search` },
      };
    case 'review_request':
      return {
        subject: `How was ${d.venueName}?`,
        heading: `How was ${d.venueName}?`,
        greetingName,
        paragraphs: [
          `We hope your event on ${longDate(d)} went beautifully.`,
          'A short review helps other families choose the right hall.',
        ],
        action: { label: 'Write a review', url: viewBooking.url },
      };
    case 'owner_new_booking':
      return {
        subject: `New booking: ${d.eventDate} (${d.refCode})`,
        heading: 'You have a new booking',
        greetingName,
        paragraphs: [`${d.customerName ?? 'A customer'} booked ${what}.`],
        details: [
          ...details,
          ...(d.customerName ? [{ label: 'Customer', value: d.customerName }] : []),
          { label: 'Advance paid online', value: formatInr(d.paidPaise) },
          { label: 'Balance due at the venue', value: formatInr(balance) },
        ],
        action: ownerBookings,
      };
    case 'owner_request_pending':
      return {
        subject: `Action needed: booking request for ${d.eventDate} (${d.refCode})`,
        heading: 'A booking request needs your answer',
        greetingName,
        paragraphs: [
          `${d.customerName ?? 'A customer'} has paid ${formatInr(d.paidPaise)} to book ${what}.`,
          'Accept or decline within 24 hours, or the request is declined and refunded automatically.',
        ],
        details: [
          ...details,
          ...(d.customerName ? [{ label: 'Customer', value: d.customerName }] : []),
          { label: 'Paid', value: formatInr(d.paidPaise) },
        ],
        action: { label: 'Accept or decline', url: ownerBookings.url },
      };
    case 'admin_booking_alert': {
      const h = ADMIN_HEADINGS[d.toStatus ?? ''] ?? {
        subject: 'Booking update',
        heading: 'A booking changed',
      };
      return {
        subject: `${h.subject}: ${d.venueName}, ${d.eventDate} (${d.refCode})`,
        heading: h.heading,
        paragraphs: [`${d.venueName} (${d.hallName}) on ${when(d)}.`],
        details: [
          ...details,
          { label: 'Status', value: (d.toStatus ?? '').replaceAll('_', ' ').toLowerCase() },
          ...(d.reason ? [{ label: 'Reason', value: REASONS[d.reason] ?? d.reason }] : []),
          { label: 'Total', value: formatInr(d.totalPaise) },
          { label: 'Paid online', value: formatInr(d.paidPaise) },
          ...(d.refundPaise > 0 ? [{ label: 'Refund', value: formatInr(d.refundPaise) }] : []),
        ],
        action: { label: 'Open admin', url: `${appBaseUrl}/admin` },
        note: 'You get these because your address is set as ADMIN_NOTIFY_EMAIL.',
      };
    }
    case 'owner_booking_cancelled':
      return {
        subject: `Booking cancelled: ${d.eventDate} (${d.refCode})`,
        heading: 'A booking was cancelled',
        greetingName,
        paragraphs: [`The booking for ${what} was cancelled and the date is open again.`],
        details,
        action: ownerBookings,
      };
  }
}
