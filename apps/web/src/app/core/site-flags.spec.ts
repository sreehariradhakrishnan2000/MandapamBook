import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from '../app';
import { ServerStatus } from './server-status';
import { SHOW_WAKE_BANNER } from './site-flags';

describe('site flags', () => {
  it('keeps the "starting up the server" bar hidden while it is switched off', async () => {
    expect(SHOW_WAKE_BANNER).toBe(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(App);
    TestBed.inject(ServerStatus).waking.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'Starting up the server',
    );
  });
});
