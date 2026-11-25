import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Permission } from '@mandapambook/shared';
import { AdminApi, type SystemHealthView } from '../../core/admin-api.service';
import { AuthService } from '../../core/auth/auth.service';

interface Tile {
  link: string;
  title: string;
  hint: string;
  permission: Permission;
  count?: number;
}

@Component({
  selector: 'app-admin-home',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-6 py-4">
      <h1 class="font-display text-3xl font-medium">Admin console</h1>
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        @for (t of tiles(); track t.link) {
          <li>
            <a
              [routerLink]="t.link"
              class="flex h-full flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-5 hover:border-brand-500"
            >
              <span class="flex items-center justify-between font-semibold">
                {{ t.title }}
                @if (t.count) {
                  <span
                    class="rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white"
                    [attr.aria-label]="t.count + ' waiting'"
                    >{{ t.count }}</span
                  >
                }
              </span>
              <span class="text-sm text-slate-600">{{ t.hint }}</span>
            </a>
          </li>
        }
      </ul>

      @if (health(); as h) {
        <section
          class="rounded-2xl border border-slate-200 bg-white p-5 text-sm"
          aria-labelledby="health-h"
        >
          <h2 id="health-h" class="font-display text-xl font-medium">System health</h2>
          <dl class="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[14rem_1fr]">
            <dt class="text-slate-600">Last booking email sent</dt>
            <dd>
              {{ h.email.lastSentAt ? (h.email.lastSentAt | date: 'd MMM y, h:mm a') : 'Never' }}
            </dd>
            <dt class="text-slate-600">Emails failed (24 h)</dt>
            <dd
              [class.font-semibold]="h.email.failedLast24h > 0"
              [class.text-red-700]="h.email.failedLast24h > 0"
            >
              {{ h.email.failedLast24h }}
            </dd>
            <dt class="text-slate-600">Emails waiting to send</dt>
            <dd>{{ h.email.queued }}</dd>
            <dt class="text-slate-600">Email (SMTP) key</dt>
            <dd
              [class.font-semibold]="keyWarning(h.email.daysUntilKeyExpiry)"
              [class.text-red-700]="keyWarning(h.email.daysUntilKeyExpiry)"
            >
              @if (h.email.daysUntilKeyExpiry === null) {
                <span class="text-slate-500">Expiry date not set (SMTP_KEY_EXPIRES_AT)</span>
              } @else if (h.email.daysUntilKeyExpiry <= 0) {
                Expired on {{ h.email.smtpKeyExpiresAt }}. Replace it now.
              } @else {
                Expires {{ h.email.smtpKeyExpiresAt }} (in {{ h.email.daysUntilKeyExpiry }} days)
              }
            </dd>
            <dt class="text-slate-600">Error tracking</dt>
            <dd>
              Server {{ h.errorTracking.api ? 'on' : 'off' }} · Browser
              {{ h.errorTracking.web ? 'on' : 'off' }}
            </dd>
            <dt class="text-slate-600">Version</dt>
            <dd class="font-mono">{{ h.version }}</dd>
          </dl>
        </section>
      }
    </section>
  `,
})
export class AdminHome implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthService);
  private readonly all: Tile[] = [
    {
      link: 'listings',
      title: 'Listing approvals',
      hint: 'Review venues waiting to go live',
      permission: 'listing:review',
    },
    {
      link: 'owners',
      title: 'Owner KYC',
      hint: 'Verify PAN and payout details',
      permission: 'kyc:review',
    },
    {
      link: 'users',
      title: 'Users',
      hint: 'Find accounts, suspend, change roles',
      permission: 'user:manage',
    },
    {
      link: 'master-data',
      title: 'Cities, amenities & muhurtham dates',
      hint: 'Reference data used in search and pricing',
      permission: 'masterdata:update',
    },
    {
      link: 'settings',
      title: 'Platform settings',
      hint: 'Commission, fees and GST',
      permission: 'report:view',
    },
    {
      link: 'reports',
      title: 'Reports',
      hint: 'Bookings, collections and commission; CSV export',
      permission: 'report:view',
    },
    {
      link: 'payouts',
      title: 'Owner payouts',
      hint: 'Record transfers to venue owners',
      permission: 'payout:manage',
    },
    {
      link: 'reviews',
      title: 'Reviews',
      hint: 'Hide or restore customer reviews',
      permission: 'review:moderate',
    },
    { link: 'audit', title: 'Audit log', hint: 'Who did what, and when', permission: 'audit:view' },
  ];
  protected readonly tiles = signal<Tile[]>(
    this.all.filter((t) => this.auth.hasPermission(t.permission)),
  );

  protected readonly health = signal<SystemHealthView | null>(null);

  /** Red from 30 days before the key expires. */
  protected keyWarning(days: number | null): boolean {
    return days !== null && days <= 30;
  }

  async ngOnInit(): Promise<void> {
    if (this.auth.hasPermission('report:view'))
      void this.api.systemHealth().then(
        (h) => this.health.set(h),
        () => undefined,
      );
    const [listings, owners] = await Promise.allSettled([
      this.auth.hasPermission('listing:review')
        ? this.api.listings('PENDING_REVIEW')
        : Promise.reject(new Error('skip')),
      this.auth.hasPermission('kyc:review')
        ? this.api.owners('SUBMITTED')
        : Promise.reject(new Error('skip')),
    ]);
    this.tiles.update((tiles) =>
      tiles.map((t) => ({
        ...t,
        count:
          t.link === 'listings' && listings.status === 'fulfilled'
            ? listings.value.total
            : t.link === 'owners' && owners.status === 'fulfilled'
              ? owners.value.total
              : undefined,
      })),
    );
  }
}
