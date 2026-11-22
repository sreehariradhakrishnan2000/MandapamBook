import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Permission } from '@mandapambook/shared';
import { AdminApi } from '../../core/admin-api.service';
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
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-6 py-4">
      <h1 class="font-display text-2xl font-bold">Admin console</h1>
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        @for (t of tiles(); track t.link) {
          <li>
            <a
              [routerLink]="t.link"
              class="flex h-full flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-500"
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
    { link: 'audit', title: 'Audit log', hint: 'Who did what, and when', permission: 'audit:view' },
  ];
  protected readonly tiles = signal<Tile[]>(
    this.all.filter((t) => this.auth.hasPermission(t.permission)),
  );

  async ngOnInit(): Promise<void> {
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
