import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { PlatformSettings } from '@mandapambook/shared';
import {
  AdminApi,
  type AmenityRow,
  type AuditRow,
  type CityRow,
} from '../../core/admin-api.service';
import { AuthService, errorMessage } from '../../core/auth/auth.service';

@Component({
  selector: 'app-admin-settings',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto flex max-w-lg flex-col gap-4 py-4">
      <a routerLink="/admin" class="text-sm text-brand-700 underline">← Admin</a>
      <h1 class="font-display text-3xl font-medium">Platform settings</h1>
      <p class="text-sm text-slate-600">
        Changes apply to new quotes. Existing bookings keep the price they were quoted.
      </p>
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
      @if (saved()) {
        <p class="rounded-xl bg-leaf-600/10 px-3 py-2 text-sm text-leaf-600" role="status">
          Saved.
        </p>
      }
      @if (form(); as f) {
        <form class="flex flex-col gap-3 text-sm" (ngSubmit)="save()">
          <label class="flex flex-col gap-1"
            >Commission (% of booking, kept by the platform)
            <input
              name="commission"
              type="number"
              step="0.01"
              min="0"
              max="30"
              class="rounded-xl border border-slate-300 px-2 py-1.5"
              [(ngModel)]="f.commissionPercent"
              [disabled]="!canEdit"
            />
          </label>
          <label class="flex flex-col gap-1"
            >Platform fee per booking (₹)
            <input
              name="fee"
              type="number"
              min="0"
              class="rounded-xl border border-slate-300 px-2 py-1.5"
              [(ngModel)]="f.feeRupees"
              [disabled]="!canEdit"
            />
          </label>
          <label class="flex flex-col gap-1"
            >GST (%)
            <input
              name="gst"
              type="number"
              step="0.01"
              min="0"
              max="28"
              class="rounded-xl border border-slate-300 px-2 py-1.5"
              [(ngModel)]="f.gstPercent"
              [disabled]="!canEdit"
            />
          </label>
          <label class="flex flex-col gap-1"
            >Slot hold while paying (minutes)
            <input
              name="hold"
              type="number"
              min="5"
              max="30"
              class="rounded-xl border border-slate-300 px-2 py-1.5"
              [(ngModel)]="f.holdMinutes"
              [disabled]="!canEdit"
            />
          </label>
          <label class="flex flex-col gap-1"
            >Owner response time for booking requests (hours)
            <input
              name="response"
              type="number"
              min="1"
              max="72"
              class="rounded-xl border border-slate-300 px-2 py-1.5"
              [(ngModel)]="f.responseHours"
              [disabled]="!canEdit"
            />
          </label>
          @if (canEdit) {
            <button
              type="submit"
              class="w-fit rounded-full bg-brand-600 px-4 py-2 font-semibold text-white"
            >
              Save settings
            </button>
          } @else {
            <p class="text-slate-500">Only super admins can change these.</p>
          }
        </form>
      }
    </section>
  `,
})
export class AdminSettings implements OnInit {
  private readonly api = inject(AdminApi);
  protected readonly canEdit = inject(AuthService).hasPermission('settings:update');
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);
  protected readonly form = signal<{
    commissionPercent: number;
    feeRupees: number;
    gstPercent: number;
    holdMinutes: number;
    responseHours: number;
  } | null>(null);

  async ngOnInit(): Promise<void> {
    this.apply(await this.api.settings());
  }

  private apply(s: PlatformSettings): void {
    this.form.set({
      commissionPercent: s.commission_bps / 100,
      feeRupees: s.platform_fee_paise / 100,
      gstPercent: s.gst_bps / 100,
      holdMinutes: s.hold_minutes,
      responseHours: s.owner_response_hours,
    });
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.error.set(null);
    this.saved.set(false);
    try {
      this.apply(
        await this.api.updateSettings({
          commission_bps: Math.round(f.commissionPercent * 100),
          platform_fee_paise: Math.round(f.feeRupees * 100),
          gst_bps: Math.round(f.gstPercent * 100),
          hold_minutes: f.holdMinutes,
          owner_response_hours: f.responseHours,
        }),
      );
      this.saved.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

@Component({
  selector: 'app-admin-master-data',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-6 py-4">
      <a routerLink="/admin" class="text-sm text-brand-700 underline">← Admin</a>
      <h1 class="font-display text-3xl font-medium">Reference data</h1>
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }

      <section class="flex flex-col gap-2" aria-labelledby="cities-h">
        <h2 id="cities-h" class="font-semibold">Cities</h2>
        <ul class="grid gap-1 text-sm sm:grid-cols-3">
          @for (c of cities(); track c.id) {
            <li
              class="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1"
              [class.opacity-50]="!c.isActive"
            >
              {{ c.name }}, {{ c.state }}
              <button type="button" class="text-xs underline" (click)="toggleCity(c)">
                {{ c.isActive ? 'Hide' : 'Show' }}
              </button>
            </li>
          }
        </ul>
        <form class="flex flex-wrap items-end gap-2 text-sm" (ngSubmit)="addCity()">
          <label class="flex flex-col gap-1"
            >Name<input
              name="cname"
              class="rounded-xl border border-slate-300 px-2 py-1"
              [(ngModel)]="city.name"
          /></label>
          <label class="flex flex-col gap-1"
            >District<input
              name="cdistrict"
              class="rounded-xl border border-slate-300 px-2 py-1"
              [(ngModel)]="city.district"
          /></label>
          <label class="flex flex-col gap-1"
            >State<input
              name="cstate"
              class="rounded-xl border border-slate-300 px-2 py-1"
              [(ngModel)]="city.state"
          /></label>
          <button
            type="submit"
            class="rounded-full bg-brand-600 px-3 py-1 font-semibold text-white"
          >
            Add city
          </button>
        </form>
      </section>

      <section class="flex flex-col gap-2" aria-labelledby="amen-h">
        <h2 id="amen-h" class="font-semibold">Amenities</h2>
        <ul class="grid gap-1 text-sm sm:grid-cols-3">
          @for (a of amenities(); track a.id) {
            <li
              class="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1"
              [class.opacity-50]="!a.isActive"
            >
              {{ a.name }}
              <button type="button" class="text-xs underline" (click)="toggleAmenity(a)">
                {{ a.isActive ? 'Hide' : 'Show' }}
              </button>
            </li>
          }
        </ul>
        <form class="flex flex-wrap items-end gap-2 text-sm" (ngSubmit)="addAmenity()">
          <label class="flex flex-col gap-1"
            >Name<input
              name="aname"
              class="rounded-xl border border-slate-300 px-2 py-1"
              [(ngModel)]="amenityName"
          /></label>
          <button
            type="submit"
            class="rounded-full bg-brand-600 px-3 py-1 font-semibold text-white"
          >
            Add amenity
          </button>
        </form>
      </section>

      <section class="flex flex-col gap-2" aria-labelledby="muh-h">
        <h2 id="muh-h" class="font-semibold">Upcoming muhurtham dates</h2>
        <ul class="flex flex-wrap gap-2 text-sm">
          @for (m of muhurtham(); track m.date) {
            <li class="rounded-full bg-brand-50 px-3 py-1 text-brand-700">
              {{ m.date }} {{ m.label ?? '' }}
              <button type="button" class="ml-1 underline" (click)="removeMuhurtham(m.date)">
                Remove<span class="sr-only"> {{ m.date }}</span>
              </button>
            </li>
          } @empty {
            <li class="text-slate-500">None listed.</li>
          }
        </ul>
        <form class="flex flex-wrap items-end gap-2 text-sm" (ngSubmit)="addMuhurtham()">
          <label class="flex flex-col gap-1"
            >Date<input
              name="mdate"
              type="date"
              class="rounded-xl border border-slate-300 px-2 py-1"
              [(ngModel)]="mDate"
          /></label>
          <label class="flex flex-col gap-1"
            >Label<input
              name="mlabel"
              class="rounded-xl border border-slate-300 px-2 py-1"
              [(ngModel)]="mLabel"
          /></label>
          <button
            type="submit"
            class="rounded-full bg-brand-600 px-3 py-1 font-semibold text-white"
          >
            Add date
          </button>
        </form>
      </section>
    </section>
  `,
})
export class AdminMasterData implements OnInit {
  private readonly api = inject(AdminApi);
  protected readonly cities = signal<CityRow[]>([]);
  protected readonly amenities = signal<AmenityRow[]>([]);
  protected readonly muhurtham = signal<{ date: string; label: string | null }[]>([]);
  protected readonly error = signal<string | null>(null);
  protected city = { name: '', district: '', state: '' };
  protected amenityName = '';
  protected mDate = '';
  protected mLabel = '';

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    const [c, a, m] = await Promise.all([
      this.api.cities(),
      this.api.amenities(),
      this.api.muhurthamDates(),
    ]);
    this.cities.set(c.items);
    this.amenities.set(a.items);
    this.muhurtham.set(m.items);
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await fn();
      await this.reload();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private slug = (s: string, sep: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, sep)
      .replace(new RegExp(`^\\${sep}|\\${sep}$`, 'g'), '');

  protected addCity = () =>
    this.run(async () => {
      await this.api.addCity({ ...this.city, slug: this.slug(this.city.name, '-') });
      this.city = { name: '', district: '', state: '' };
    });
  protected toggleCity = (c: CityRow) => this.run(() => this.api.setCityActive(c.id, !c.isActive));
  protected addAmenity = () =>
    this.run(async () => {
      await this.api.addAmenity(this.slug(this.amenityName, '_'), this.amenityName.trim());
      this.amenityName = '';
    });
  protected toggleAmenity = (a: AmenityRow) =>
    this.run(() => this.api.setAmenityActive(a.id, !a.isActive));
  protected addMuhurtham = () =>
    this.run(() => this.api.addMuhurtham(this.mDate, this.mLabel.trim() || undefined));
  protected removeMuhurtham = (date: string) => this.run(() => this.api.removeMuhurtham(date));
}

@Component({
  selector: 'app-admin-audit',
  imports: [DatePipe, FormsModule, JsonPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <a routerLink="/admin" class="text-sm text-brand-700 underline">← Admin</a>
      <h1 class="font-display text-3xl font-medium">Audit log</h1>
      <form class="flex flex-wrap items-end gap-2 text-sm" (ngSubmit)="load(true)">
        <label class="flex flex-col gap-1"
          >Action<input
            name="action"
            placeholder="e.g. listing.approved"
            class="rounded-xl border border-slate-300 px-2 py-1.5"
            [(ngModel)]="action"
        /></label>
        <label class="flex flex-col gap-1"
          >Entity id<input
            name="entityId"
            class="rounded-xl border border-slate-300 px-2 py-1.5"
            [(ngModel)]="entityId"
        /></label>
        <button
          type="submit"
          class="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white"
        >
          Filter
        </button>
      </form>
      <ol class="flex flex-col gap-2 text-sm">
        @for (e of items(); track e.id) {
          <li
            class="rounded-xl border border-slate-200 bg-white px-3 py-2"
            [class.border-red-300]="!e.success"
          >
            <div class="flex flex-wrap justify-between gap-2">
              <span class="font-mono font-semibold">{{ e.action }}</span>
              <span class="tabular-nums text-slate-500">{{
                e.createdAt | date: 'd MMM y, HH:mm:ss'
              }}</span>
            </div>
            <p class="text-slate-600">
              {{ e.entityType }} {{ e.entityId }} · by {{ e.actorRole ?? 'system' }}
              {{ e.actorId ?? '' }} · {{ e.ip ?? '' }}
            </p>
            @if (e.before || e.after) {
              <details>
                <summary class="cursor-pointer text-brand-700">Changes</summary>
                <pre class="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{{
                  { before: e.before, after: e.after } | json
                }}</pre>
              </details>
            }
          </li>
        } @empty {
          <li class="text-slate-500">No entries.</li>
        }
      </ol>
      @if (next()) {
        <button
          type="button"
          class="w-fit rounded-full border border-slate-300 px-3 py-1.5 text-sm"
          (click)="load(false)"
        >
          Older entries
        </button>
      }
    </section>
  `,
})
export class AdminAudit implements OnInit {
  private readonly api = inject(AdminApi);
  protected action = '';
  protected entityId = '';
  protected readonly items = signal<AuditRow[]>([]);
  protected readonly next = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load(true);
  }

  protected async load(reset: boolean): Promise<void> {
    const page = await this.api.auditLogs({
      action: this.action.trim() || undefined,
      entityId: this.entityId.trim() || undefined,
      before: reset ? undefined : (this.next() ?? undefined),
    });
    this.items.set(reset ? page.items : [...this.items(), ...page.items]);
    this.next.set(page.nextBefore);
  }
}
