/**
 * Business details shown on the legal pages and the Contact page. Keep them identical to
 * the Razorpay KYC: reviewers compare the website with the documents.
 *
 * TODO before live payments: fill in `address`, `phone` and `grievanceOfficer.name`.
 * Until then the pages say the details will be published shortly.
 */
export const LEGAL = {
  brand: 'MandapamBook',
  /** The person or company legally responsible for the platform. */
  operator: 'Sreehari R',
  operatorDescription: 'Sreehari R, a sole proprietor trading as MandapamBook',
  website: 'mandapambooking.in',
  supportEmail: 'support@mandapambooking.in',
  supportHours: 'Monday to Saturday, 10 am to 6 pm (India time)',
  phone: null as string | null,
  /** Full postal address, one line per entry. */
  address: null as string[] | null,
  grievanceOfficer: {
    name: null as string | null,
    email: 'support@mandapambooking.in',
  },
  /** Courts with jurisdiction over disputes. */
  jurisdiction: 'Kollam, Kerala',
  lastUpdated: '27 November 2026',
} as const;
