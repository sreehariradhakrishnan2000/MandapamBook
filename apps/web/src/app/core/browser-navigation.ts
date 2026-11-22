import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** Full-page navigation (leaving the SPA), wrapped so it can be replaced in tests. */
@Injectable({ providedIn: 'root' })
export class BrowserNavigation {
  private readonly document = inject(DOCUMENT);

  assign(url: string): void {
    this.document.location.assign(url);
  }
}
