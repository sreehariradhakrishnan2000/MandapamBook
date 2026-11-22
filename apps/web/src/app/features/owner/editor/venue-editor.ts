import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService, errorMessage } from '../../../core/auth/auth.service';
import { OwnerApi, type VenueDetail } from '../../../core/owner-api.service';
import { StatusChip } from '../status-chip';
import { VenueCalendar } from './calendar';
import { HallsPricing } from './halls-pricing';
import { VenuePhotos } from './photos';
import { VenuePolicies } from './policies';
import { VenueForm } from './venue-form';

type Tab = 'details' | 'halls' | 'photos' | 'policies' | 'calendar';

@Component({
  selector: 'app-venue-editor',
  imports: [
    RouterLink,
    StatusChip,
    VenueForm,
    HallsPricing,
    VenuePhotos,
    VenuePolicies,
    VenueCalendar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-5 py-4">
      <a routerLink="/owner" class="text-sm text-brand-700 underline">← My venues</a>
      @if (venue(); as v) {
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <h1 class="font-display text-2xl font-bold">{{ v.name }}</h1>
            <app-status-chip [status]="v.status" />
          </div>
          @if (isOwner && (v.status === 'DRAFT' || v.status === 'REJECTED')) {
            <button
              type="button"
              (click)="submit()"
              class="rounded-md bg-brand-600 px-4 py-2 font-semibold text-white"
            >
              Submit for review
            </button>
          }
        </header>
        @if (v.status === 'REJECTED' && v.rejectionReason) {
          <p class="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
            Reviewer feedback: {{ v.rejectionReason }}
          </p>
        }
        @if (missing().length) {
          <div class="rounded-md bg-brand-50 px-4 py-3 text-sm text-brand-700" role="alert">
            <p class="font-semibold">Finish these before submitting:</p>
            <ul class="mt-1 list-disc pl-5">
              @for (m of missing(); track m) {
                <li>{{ m }}</li>
              }
            </ul>
          </div>
        }
        @if (message()) {
          <p class="rounded-md bg-leaf-600/10 px-4 py-3 text-sm text-leaf-600" role="status">
            {{ message() }}
          </p>
        }

        <div
          role="tablist"
          aria-label="Venue sections"
          class="flex gap-1 overflow-x-auto border-b border-slate-200"
        >
          @for (t of tabs; track t.id) {
            @if (isOwner || t.id === 'calendar') {
              <button
                role="tab"
                type="button"
                [attr.aria-selected]="tab() === t.id"
                [attr.aria-controls]="'panel-' + t.id"
                [id]="'tab-' + t.id"
                (click)="tab.set(t.id)"
                class="whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium"
                [class]="
                  tab() === t.id
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-600'
                "
              >
                {{ t.label }}
              </button>
            }
          }
        </div>

        <div role="tabpanel" [id]="'panel-' + tab()" [attr.aria-labelledby]="'tab-' + tab()">
          @switch (tab()) {
            @case ('details') {
              <app-venue-form [venue]="v" (saved)="reload()" />
            }
            @case ('halls') {
              <app-halls-pricing [venueId]="v.id" [halls]="v.halls" (changed)="reload()" />
            }
            @case ('photos') {
              <app-venue-photos [venueId]="v.id" [photos]="v.photos" (changed)="reload()" />
            }
            @case ('policies') {
              <app-venue-policies [venue]="v" (changed)="reload()" />
            }
            @case ('calendar') {
              <app-venue-calendar [halls]="v.halls" />
            }
          }
        </div>
      } @else if (error()) {
        <p class="text-red-700" role="alert">{{ error() }}</p>
      } @else {
        <p>Loading…</p>
      }
    </section>
  `,
})
export class VenueEditor implements OnInit {
  private readonly api = inject(OwnerApi);
  private readonly router = inject(Router);
  readonly id = input.required<string>();

  protected readonly isOwner = inject(AuthService).hasPermission('auditorium:update');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'halls', label: 'Halls & prices' },
    { id: 'photos', label: 'Photos' },
    { id: 'policies', label: 'Amenities & policies' },
    { id: 'calendar', label: 'Calendar' },
  ];
  protected readonly tab = signal<Tab>('details');
  protected readonly venue = signal<VenueDetail | null>(null);
  protected readonly missing = signal<string[]>([]);
  protected readonly message = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!this.isOwner) this.tab.set('calendar');
    await this.reload();
  }

  protected async reload(): Promise<void> {
    try {
      this.venue.set(await this.api.venue(this.id()));
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) {
        await this.router.navigateByUrl('/owner');
        return;
      }
      this.error.set(errorMessage(err, 'Could not load this venue.'));
    }
  }

  protected async submit(): Promise<void> {
    this.missing.set([]);
    this.message.set(null);
    try {
      await this.api.submitVenue(this.id());
      this.message.set('Submitted. We review listings within two working days.');
      await this.reload();
    } catch (err) {
      const details =
        err instanceof HttpErrorResponse ? (err.error?.error?.details as unknown) : null;
      if (Array.isArray(details))
        this.missing.set(details.filter((d): d is string => typeof d === 'string'));
      else this.message.set(errorMessage(err));
    }
  }
}

@Component({
  selector: 'app-venue-new',
  imports: [RouterLink, VenueForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <a routerLink="/owner" class="text-sm text-brand-700 underline">← My venues</a>
      <h1 class="font-display text-2xl font-bold">Add a venue</h1>
      <p class="text-slate-600">Start with the basics. You'll add halls, prices and photos next.</p>
      <app-venue-form (saved)="open($event.id)" />
    </section>
  `,
})
export class VenueNew {
  private readonly router = inject(Router);
  protected open(id: string): void {
    void this.router.navigate(['/owner/venues', id]);
  }
}
