import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ListingDecision } from '@mandapambook/shared';
import { AdminApi, type QueueItem, type ReviewDetail } from '../../core/admin-api.service';
import { errorMessage } from '../../core/auth/auth.service';
import type { ListingStatus } from '../../core/owner-api.service';
import { InrPipe } from '../../shared/inr.pipe';
import { StatusChip } from '../owner/status-chip';

@Component({
  selector: 'app-admin-listings',
  imports: [DatePipe, FormsModule, RouterLink, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <a routerLink="/admin" class="text-sm text-brand-700 underline">← Admin</a>
      <h1 class="font-display text-3xl font-medium">Listing approvals</h1>
      <form class="flex flex-wrap items-end gap-2 text-sm" (ngSubmit)="load()">
        <label class="flex flex-col gap-1"
          >Status
          <select
            name="status"
            class="rounded-xl border border-slate-300 px-2 py-1.5"
            [(ngModel)]="status"
          >
            <option value="PENDING_REVIEW">In review</option>
            <option value="APPROVED">Live</option>
            <option value="REJECTED">Changes needed</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DRAFT">Draft</option>
          </select>
        </label>
        <label class="flex flex-col gap-1"
          >Search venue or owner email<input
            name="q"
            class="rounded-xl border border-slate-300 px-2 py-1.5"
            [(ngModel)]="q"
        /></label>
        <button
          type="submit"
          class="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white"
        >
          Show
        </button>
      </form>
      <p class="text-sm text-slate-600" aria-live="polite">{{ total() }} listing(s)</p>
      <ul class="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        @for (l of items(); track l.id) {
          <li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span class="min-w-0">
              <a [routerLink]="l.id" class="font-semibold hover:text-brand-700">{{ l.name }}</a>
              <span class="block text-slate-500"
                >{{ l.city }} · {{ l.ownerName }} ({{ l.ownerEmail }}) · KYC
                {{ l.kycStatus.toLowerCase().replace('_', ' ') }}</span
              >
            </span>
            <span class="flex items-center gap-2"
              ><app-status-chip [status]="l.status" /><span class="text-xs text-slate-500">{{
                l.updatedAt | date: 'd MMM, h:mm a'
              }}</span></span
            >
          </li>
        } @empty {
          <li class="px-4 py-6 text-sm text-slate-500">Nothing here.</li>
        }
      </ul>
    </section>
  `,
})
export class AdminListings implements OnInit {
  private readonly api = inject(AdminApi);
  protected status: ListingStatus = 'PENDING_REVIEW';
  protected q = '';
  protected readonly items = signal<QueueItem[]>([]);
  protected readonly total = signal(0);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async load(): Promise<void> {
    const page = await this.api.listings(this.status, this.q.trim() || undefined);
    this.items.set(page.items);
    this.total.set(page.total);
  }
}

@Component({
  selector: 'app-admin-listing-review',
  imports: [FormsModule, RouterLink, StatusChip, InrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-5 py-4">
      <a routerLink="/admin/listings" class="text-sm text-brand-700 underline"
        >← Listing approvals</a
      >
      @if (detail(); as d) {
        <header class="flex flex-wrap items-center gap-3">
          <h1 class="font-display text-3xl font-medium">{{ d.name }}</h1>
          <app-status-chip [status]="d.status" />
        </header>
        <p class="text-sm text-slate-600">
          {{ d.addressLine }}, {{ d.city }} {{ d.pincode }} · Owner {{ d.owner.fullName }} ({{
            d.owner.email
          }}) · KYC {{ d.owner.kycStatus.toLowerCase() }}
        </p>

        @if (d.gaps.length || d.owner.kycStatus !== 'VERIFIED') {
          <div class="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
            <p class="font-semibold">Blocking approval</p>
            <ul class="list-disc pl-5">
              @if (d.owner.kycStatus !== 'VERIFIED') {
                <li>
                  Owner KYC is not verified.
                  <a routerLink="/admin/owners" class="underline">Review KYC</a>
                </li>
              }
              @for (g of d.gaps; track g) {
                <li>{{ g }}</li>
              }
            </ul>
          </div>
        }

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          @for (p of d.photos; track p.id) {
            @if (p.url) {
              <img
                [src]="p.url"
                [alt]="p.altText || 'Venue photo'"
                class="aspect-[4/3] w-full rounded object-cover"
                loading="lazy"
              />
            }
          }
        </div>

        <p class="whitespace-pre-line text-sm">{{ d.description || 'No description.' }}</p>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt class="text-slate-500">Catering</dt>
          <dd>{{ d.cateringPolicy.toLowerCase().replaceAll('_', ' ') }}</dd>
          <dt class="text-slate-500">Decoration</dt>
          <dd>{{ d.decorationPolicy.toLowerCase().replaceAll('_', ' ') }}</dd>
          <dt class="text-slate-500">Advance</dt>
          <dd>{{ d.advancePercent }}%</dd>
          <dt class="text-slate-500">Booking</dt>
          <dd>{{ d.instantBook ? 'Instant' : 'Owner approves' }}</dd>
        </dl>
        @for (h of d.halls; track h.id) {
          <div class="text-sm">
            <p class="font-semibold">
              {{ h.name }} · {{ h.seatingCapacity }} seats · {{ h.isAc ? 'AC' : 'Non-AC' }}
            </p>
            <p class="text-slate-600">
              @for (r of h.pricingRules; track $index) {
                {{ r.kind.toLowerCase() }} {{ r.slot.toLowerCase().replace('_', ' ') }}:
                {{ r.pricePaise | inr }};
              }
            </p>
          </div>
        }
        <p class="text-sm">
          <span class="text-slate-500">Amenities:</span>
          @for (a of d.amenities; track a.code) {
            {{ a.name }}{{ $last ? '' : ', ' }}
          } @empty {
            none
          }
        </p>

        <form
          class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
          (ngSubmit)="decide()"
        >
          <h2 class="font-semibold">Decision</h2>
          @if (error()) {
            <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {{ error() }}
            </p>
          }
          @if (done()) {
            <p class="rounded-xl bg-leaf-600/10 px-3 py-2 text-sm text-leaf-600" role="status">
              {{ done() }}
            </p>
          }
          <fieldset class="flex flex-wrap gap-4 text-sm">
            <legend class="sr-only">Decision</legend>
            @for (opt of options(); track opt.value) {
              <label class="flex items-center gap-2"
                ><input type="radio" name="decision" [value]="opt.value" [(ngModel)]="choice" />
                {{ opt.label }}</label
              >
            }
          </fieldset>
          @if (choice === 'reject' || choice === 'suspend') {
            <label class="flex flex-col gap-1 text-sm"
              >Reason (sent to the owner)
              <textarea
                name="reason"
                rows="3"
                minlength="10"
                required
                class="rounded-xl border border-slate-300 px-2 py-1.5"
                [(ngModel)]="reason"
              ></textarea>
            </label>
          }
          <button
            type="submit"
            class="w-fit rounded-full bg-brand-600 px-4 py-2 font-semibold text-white"
            [disabled]="!options().length"
          >
            Confirm
          </button>
        </form>
      }
    </section>
  `,
})
export class AdminListingReview implements OnInit {
  private readonly api = inject(AdminApi);
  readonly id = input.required<string>();
  protected readonly detail = signal<ReviewDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  protected choice: ListingDecision['decision'] | '' = '';
  protected reason = '';

  protected readonly options = signal<{ value: ListingDecision['decision']; label: string }[]>([]);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    const d = await this.api.listing(this.id());
    this.detail.set(d);
    const byStatus: Partial<
      Record<ListingStatus, { value: ListingDecision['decision']; label: string }[]>
    > = {
      PENDING_REVIEW: [
        { value: 'approve', label: 'Approve' },
        { value: 'reject', label: 'Ask for changes' },
      ],
      APPROVED: [{ value: 'suspend', label: 'Suspend' }],
      SUSPENDED: [{ value: 'reinstate', label: 'Reinstate' }],
    };
    this.options.set(byStatus[d.status] ?? []);
    this.choice = '';
  }

  protected async decide(): Promise<void> {
    this.error.set(null);
    this.done.set(null);
    if (!this.choice) {
      this.error.set('Choose a decision.');
      return;
    }
    const decision: ListingDecision =
      this.choice === 'reject' || this.choice === 'suspend'
        ? { decision: this.choice, reason: this.reason.trim() }
        : { decision: this.choice };
    try {
      const res = await this.api.decide(this.id(), decision);
      this.done.set(
        `Saved. The listing is now ${res.status.toLowerCase().replace('_', ' ')} and the owner has been emailed.`,
      );
      this.reason = '';
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
