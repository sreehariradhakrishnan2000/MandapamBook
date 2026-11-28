import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Contact } from './contact';
import { LEGAL } from './legal-info';
import { Privacy } from './privacy';
import { RefundPolicy } from './refund-policy';
import { Terms } from './terms';

describe('legal pages', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const render = (component: unknown) => {
    const fixture = TestBed.createComponent(component as never);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it.each([
    [Terms, 'Terms of Use'],
    [Privacy, 'Privacy Policy'],
    [RefundPolicy, 'Refund & Cancellation Policy'],
    [Contact, 'Contact us'],
  ])('%o shows its heading, the operator and links to the other pages', (component, heading) => {
    const el = render(component);
    expect(el.querySelector('h1')?.textContent).toBe(heading);
    expect(el.textContent).toContain(LEGAL.lastUpdated);
    const links = [...el.querySelectorAll('nav[aria-label="Legal pages"] a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual(['/terms', '/privacy', '/refund-policy', '/contact']);
  });

  it('names the operator, the support email and the courts in the terms', () => {
    const text = render(Terms).textContent ?? '';
    expect(text).toContain(LEGAL.operatorDescription);
    expect(text).toContain(LEGAL.supportEmail);
    expect(text).toContain(`Courts at ${LEGAL.jurisdiction}`);
  });

  it('states the refund rules the booking code applies', () => {
    const text = render(RefundPolicy).textContent ?? '';
    expect(text).toContain('platform fee is not refundable');
    expect(text).toContain('does not answer your request within 24 hours');
    expect(text).toContain('instant refunds');
    expect(text).toContain('5 to 7 working days');
  });

  it('marks missing contact details as coming soon instead of leaving them blank', () => {
    const text = render(Contact).textContent ?? '';
    expect(text).toContain(LEGAL.supportEmail);
    if (!LEGAL.address || !LEGAL.phone || !LEGAL.grievanceOfficer.name)
      expect(text).toContain('Will be published here shortly.');
  });
});
