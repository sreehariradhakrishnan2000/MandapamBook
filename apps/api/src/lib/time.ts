/** Venue dates are calendar dates in India Standard Time. */
export const VENUE_TIME_ZONE = 'Asia/Kolkata';

const isoDateInIst = new Intl.DateTimeFormat('en-CA', {
  timeZone: VENUE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in IST as YYYY-MM-DD (so 00:30 IST is already "tomorrow" relative to UTC). */
export function todayInIst(now: Date = new Date()): string {
  return isoDateInIst.format(now);
}
