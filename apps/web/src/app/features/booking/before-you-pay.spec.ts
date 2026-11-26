import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BeforeYouPay, daysUntil } from './before-you-pay';

const TIERS = [
  { minDaysBefore: 60, refundPercent: 90 },
  { minDaysBefore: 30, refundPercent: 50 },
  { minDaysBefore: 7, refundPercent: 25 },
  { minDaysBefore: 0, refundPercent: 0 },
];

function isoInDays(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

describe('before you pay', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  function render(eventDate: string, tiers = TIERS) {
    const fixture = TestBed.createComponent(BeforeYouPay);
    fixture.componentRef.setInput('tiers', tiers);
    fixture.componentRef.setInput('eventDate', eventDate);
    fixture.componentRef.setInput('platformFeePaise', 49_900);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('counts whole days to the event', () => {
    expect(daysUntil('2026-11-30', '2026-11-27')).toBe(3);
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('summarises the venue tiers, the fee and what cancelling today would refund', () => {
    const { el } = render(isoInDays(3));
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('60 or more days before the event: 90% of the advance back');
    expect(text).toContain('Less than 7 days before: no refund');
    expect(text).toContain('platform fee (₹499.00) is not refundable');
    expect(text).toContain('Your event is in 3 days: cancelling now would give no refund');

    const far = render(isoInDays(45)).el.textContent!.replace(/\s+/g, ' ');
    expect(far).toContain('cancelling today would refund 50% of the advance');
  });

  it('reports the tick back to the booking page and links the policies', () => {
    const { fixture, el } = render(isoInDays(90));
    expect(fixture.componentInstance.agreed()).toBe(false);
    el.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    expect(fixture.componentInstance.agreed()).toBe(true);
    const links = [...el.querySelectorAll('label a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/terms', '/refund-policy']);
  });

  it('says plainly when a venue gives no refund at all', () => {
    const { el } = render(isoInDays(90), []);
    expect(el.textContent).toContain('Cancelling gives no refund of the advance');
  });
});
