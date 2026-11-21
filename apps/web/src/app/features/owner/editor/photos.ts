import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MEDIA_MAX_BYTES, MEDIA_MAX_PER_VENUE, MEDIA_TYPES } from '@mandapambook/shared';
import { errorMessage } from '../../../core/auth/auth.service';
import { OwnerApi, type Photo } from '../../../core/owner-api.service';

@Component({
  selector: 'app-venue-photos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <p class="text-sm text-slate-600">
        JPEG, PNG or WebP, up to 10 MB each, {{ maxPhotos }} photos at most. At least 3 are needed
        to submit.
      </p>
      @if (error()) {
        <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        @for (p of photos(); track p.id) {
          <li class="relative overflow-hidden rounded-md border border-slate-200 bg-slate-100">
            @if (p.url) {
              <img
                [src]="p.url"
                [alt]="p.altText || 'Venue photo'"
                class="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
            } @else {
              <div class="flex aspect-[4/3] items-center justify-center text-xs text-slate-500">
                Processing…
              </div>
            }
            <button
              type="button"
              (click)="remove(p.id)"
              class="absolute right-1 top-1 rounded bg-white/90 px-2 py-0.5 text-xs text-red-700"
            >
              Remove<span class="sr-only"> photo {{ p.altText }}</span>
            </button>
          </li>
        }
      </ul>
      <label
        class="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-brand-600 px-3 py-2 font-semibold text-brand-700"
      >
        <input
          type="file"
          class="sr-only"
          [accept]="accept"
          multiple
          (change)="upload($event)"
          [disabled]="busy()"
        />
        {{ busy() ? 'Uploading…' : 'Add photos' }}
      </label>
    </div>
  `,
})
export class VenuePhotos {
  private readonly api = inject(OwnerApi);
  readonly venueId = input.required<string>();
  readonly photos = input.required<Photo[]>();
  readonly changed = output();

  protected readonly maxPhotos = MEDIA_MAX_PER_VENUE;
  protected readonly accept = MEDIA_TYPES.join(',');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async upload(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const files = [...(inputEl.files ?? [])];
    inputEl.value = '';
    // Checked again on the server; this just gives a quick, friendly message.
    const bad = files.find(
      (f) => !(MEDIA_TYPES as readonly string[]).includes(f.type) || f.size > MEDIA_MAX_BYTES,
    );
    if (bad) {
      this.error.set(`${bad.name} is not a JPEG, PNG or WebP under 10 MB.`);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      for (const file of files)
        await this.api.uploadPhoto(this.venueId(), file, file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      this.error.set(errorMessage(err, 'Upload failed. Try again.'));
    } finally {
      this.busy.set(false);
      this.changed.emit();
    }
  }

  protected async remove(id: string): Promise<void> {
    await this.api.removePhoto(id);
    this.changed.emit();
  }
}
