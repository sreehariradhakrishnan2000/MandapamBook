import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App, scheduleLabel } from './app';
import { routes } from './app.routes';

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('renders the brand link, main landmark and a sign-in link when signed out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('header a')?.textContent).toContain('MandapamBook');
    expect(el.querySelector('main#main')).not.toBeNull();
    expect(el.querySelector('a[href="/login"]')?.textContent).toContain('Sign in');
  });

  it('offers a skip link to the main content', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const skip = (fixture.nativeElement as HTMLElement).querySelector('a[href="#main"]');
    expect(skip?.textContent?.trim()).toBe('Skip to content');
  });
});

describe('scheduled maintenance label', () => {
  it('shows a same-day window in India time once', () => {
    // 17:30-18:00 UTC is 11:00 pm to 11:30 pm India time.
    expect(scheduleLabel('2030-01-09T17:30:00Z', '2030-01-09T18:00:00Z')).toMatch(
      /Wed, 9 Jan, 11:00\s?pm – 11:30\s?pm/i,
    );
  });
  it('repeats the day when the window crosses midnight India time', () => {
    expect(scheduleLabel('2030-01-09T17:30:00Z', '2030-01-09T18:30:00Z')).toMatch(
      /Wed, 9 Jan, 11:00\s?pm – Thu, 10 Jan, 12:00\s?am/i,
    );
  });
});
