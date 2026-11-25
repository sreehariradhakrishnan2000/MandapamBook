import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** How often an open tab checks whether a new release has been deployed. */
export const UPDATE_CHECK_MS = 10 * 60_000;

/**
 * The browser-side health of the app: whether we are online, whether a newer release is
 * live than the one this tab is running, and whether something on the page broke.
 * The app shell turns these into banners.
 */
@Injectable({ providedIn: 'root' })
export class Connectivity {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;

  readonly online = signal(this.window?.navigator.onLine ?? true);
  /** A newer release is deployed; this tab should reload to get it. */
  readonly updateAvailable = signal(false);
  /** An unexpected error broke part of the page. */
  readonly pageError = signal(false);
  /** The page we navigated to could not load at all. */
  readonly navigationFailed = signal(false);

  /** The hashed main script this tab was loaded with, e.g. "main-ABC123.js". */
  private readonly loadedBuild = this.currentBuild();

  constructor() {
    const w = this.window;
    if (!w) return;
    const online = () => this.online.set(true);
    const offline = () => this.online.set(false);
    const visible = () => {
      if (this.document.visibilityState === 'visible') void this.checkForUpdate();
    };
    w.addEventListener('online', online);
    w.addEventListener('offline', offline);
    this.document.addEventListener('visibilitychange', visible);
    const timer = w.setInterval(() => void this.checkForUpdate(), UPDATE_CHECK_MS);
    inject(DestroyRef).onDestroy(() => {
      w.removeEventListener('online', online);
      w.removeEventListener('offline', offline);
      this.document.removeEventListener('visibilitychange', visible);
      w.clearInterval(timer);
    });
  }

  /** Resolves when the browser is back online (or immediately if it is). */
  whenOnline(timeoutMs: number): Promise<boolean> {
    const w = this.window;
    if (!w || this.online()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        w.removeEventListener('online', back);
        w.clearTimeout(timer);
        resolve(ok);
      };
      const back = () => done(true);
      const timer = w.setTimeout(() => done(false), timeoutMs);
      w.addEventListener('online', back);
    });
  }

  /**
   * Compares the main script named by the live index.html with the one this tab runs. Each
   * release changes that file's hash, so a difference means a newer release is live.
   */
  async checkForUpdate(): Promise<boolean> {
    if (!this.loadedBuild || this.updateAvailable() || typeof fetch === 'undefined') {
      return this.updateAvailable();
    }
    try {
      const res = await fetch('/', { cache: 'no-store' });
      if (!res.ok) return false;
      const live = MAIN_SCRIPT.exec(await res.text())?.[0];
      if (live && live !== this.loadedBuild) this.updateAvailable.set(true);
    } catch {
      // offline or asleep: try again later
    }
    return this.updateAvailable();
  }

  reload(): void {
    this.window?.location.reload();
  }

  private currentBuild(): string | null {
    const scripts = [...this.document.querySelectorAll<HTMLScriptElement>('script[src]')];
    for (const s of scripts) {
      const match = MAIN_SCRIPT.exec(s.getAttribute('src') ?? '');
      if (match) return match[0];
    }
    return null;
  }
}

/** Angular's hashed entry script, e.g. main-6NPMP3XQ.js. */
const MAIN_SCRIPT = /main-[A-Za-z0-9]+\.js/;

/** A lazily loaded page could not be fetched, usually because a new release replaced it. */
export function isChunkLoadError(err: unknown): boolean {
  const text = String((err as { message?: unknown })?.message ?? err);
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(
    text,
  );
}
