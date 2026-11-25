import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BrowserNavigation } from '../core/browser-navigation';
import { ServerStatus } from '../core/server-status';
import { MAINTENANCE_POLL_SECONDS, MaintenancePage } from './maintenance-page';

describe('maintenance page', () => {
  const reload = vi.fn();
  let status: ServerStatus;

  beforeEach(() => {
    vi.useFakeTimers();
    reload.mockReset();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: BrowserNavigation, useValue: { reload } }],
    });
    status = TestBed.inject(ServerStatus);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const statusReply = (enabled: boolean) =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ maintenance: { enabled, message: '', until: null } }),
    });

  it('shows the message and the expected time in India time', async () => {
    status.maintenance.set({ message: 'Upgrading payments', until: '2030-01-09T10:00:00.000Z' });
    const fixture = TestBed.createComponent(MaintenancePage);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("We're making things better");
    expect(text).toContain('Upgrading payments');
    // 10:00 UTC is 3:30 pm in India; the date and time order depends on the locale data.
    expect(text).toMatch(/Expected back by .*3:30\s?pm/i);
    expect(text).toContain('Your bookings and payments are safe');
  });

  it('falls back to the default wording, and reloads the page once maintenance is over', async () => {
    status.maintenance.set({ message: '', until: null });
    const fixture = TestBed.createComponent(MaintenancePage);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("We'll be back shortly");
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Expected back');

    vi.stubGlobal('fetch', statusReply(true));
    await vi.advanceTimersByTimeAsync(MAINTENANCE_POLL_SECONDS * 1000);
    expect(reload).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', statusReply(false));
    await vi.advanceTimersByTimeAsync(MAINTENANCE_POLL_SECONDS * 1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
