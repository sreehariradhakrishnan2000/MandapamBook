import { DOCUMENT } from '@angular/common';
import { HttpClient, type HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Reads `filename="..."` from a Content-Disposition header. */
export function filenameFrom(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  // Only a plain file name: no paths, no control characters.
  return match?.[1] && /^[\w.-]+$/.test(match[1]) ? match[1] : fallback;
}

/**
 * Authenticated downloads (invoices, CSV exports). The access token lives in memory, so
 * a plain link cannot carry it: the file is fetched through HttpClient (which adds the
 * Authorization header) and handed to the browser as a temporary object URL.
 */
@Injectable({ providedIn: 'root' })
export class FileDownload {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  async download(url: string, fallbackName: string): Promise<void> {
    const res: HttpResponse<Blob> = await firstValueFrom(
      this.http.get(url, { responseType: 'blob', observe: 'response' }),
    );
    if (!res.body) throw new Error('Empty download');
    this.save(res.body, filenameFrom(res.headers.get('Content-Disposition'), fallbackName));
  }

  /** Separate so tests can replace it; jsdom cannot follow object URLs. */
  save(blob: Blob, filename: string): void {
    const href = URL.createObjectURL(blob);
    const a = this.document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    this.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }
}
