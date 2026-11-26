import { describe, expect, it } from 'vitest';
import { escapeHtml, renderEmail } from '../../src/modules/notifications/email-layout.js';
import { renderBookingEmail } from '../../src/modules/notifications/templates.js';

const BASE = 'https://mandapambooking.in';

describe('email layout', () => {
  it('renders the same content as designed HTML and as plain text', () => {
    const mail = renderEmail(
      {
        subject: 'Verify your MandapamBook email',
        heading: 'Confirm your email address',
        greetingName: 'Meera',
        paragraphs: ['Welcome to MandapamBook.'],
        details: [{ label: 'Reference', value: 'MB-1234' }],
        action: { label: 'Verify my email', url: `${BASE}/verify-email?token=abc` },
        note: 'This link works for 24 hours.',
      },
      BASE,
    );
    expect(mail.subject).toBe('Verify your MandapamBook email');
    expect(mail.text).toBe(
      [
        'Hi Meera,',
        'Welcome to MandapamBook.',
        'Reference: MB-1234',
        `Verify my email: ${BASE}/verify-email?token=abc`,
        'This link works for 24 hours.',
        `MandapamBook\n${BASE}`,
      ].join('\n\n'),
    );
    expect(mail.html).toContain('<!doctype html>');
    expect(mail.html).toContain('Confirm your email address');
    expect(mail.html).toContain(`href="${BASE}/verify-email?token=abc"`);
    expect(mail.html).toContain(`src="${BASE}/email/kalash.png"`);
    expect(mail.html).toContain('#c2410c'); // the site's vermilion button
    expect(mail.html).toContain('Shubh Vivah');
    // The hidden preview line is padded so inboxes don't append the email's first text.
    expect(mail.html).toContain(`Welcome to MandapamBook.${'&#847;&zwnj;&nbsp;'.repeat(90)}</div>`);
  });

  it('escapes user-supplied values and refuses non-http links', () => {
    const mail = renderEmail(
      {
        subject: 'x',
        heading: '<b>Hall</b>',
        greetingName: '"><script>alert(1)</script>',
        paragraphs: ["Tom & Jerry's <hall>"],
        details: [{ label: 'Reason', value: '<img src=x onerror=alert(1)>' }],
        action: { label: 'Open', url: 'javascript:alert(1)' },
      },
      BASE,
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).toContain('&lt;b&gt;Hall&lt;/b&gt;');
    expect(mail.html).toContain('Tom &amp; Jerry&#39;s &lt;hall&gt;');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('gives every booking email a button and a details box', () => {
    const mail = renderBookingEmail(
      'booking_confirmed',
      {
        bookingId: 'b1',
        refCode: 'MB-7Q2K',
        venueName: 'Sree Krishna Convention Centre',
        hallName: 'Main hall',
        eventDate: '2027-01-20',
        slot: 'MORNING',
        totalPaise: 15_000_000,
        paidPaise: 3_800_000,
        refundPaise: 0,
        recipientName: 'Anu',
      },
      BASE,
    );
    expect(mail.html).toContain('Your booking is confirmed');
    expect(mail.html).toContain('View your booking');
    expect(mail.html).toContain(`${BASE}/account/bookings/b1`);
    expect(mail.html).toContain('MB-7Q2K');
    expect(mail.html).toContain('₹1,12,000'); // balance at the venue
  });
});
