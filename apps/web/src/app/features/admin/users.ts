import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ROLES, type Role } from '@mandapambook/shared';
import { AdminApi, type AdminUser } from '../../core/admin-api.service';
import { AuthService, errorMessage } from '../../core/auth/auth.service';

@Component({
  selector: 'app-admin-users',
  imports: [DatePipe, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <a routerLink="/admin" class="tap w-fit text-sm text-brand-700 underline">← Admin</a>
      <h1 class="font-display text-3xl font-medium">Users</h1>
      <form class="flex flex-wrap items-end gap-2 text-sm" (ngSubmit)="load()">
        <label class="flex flex-col gap-1"
          >Name, email or phone<input
            name="q"
            class="rounded-xl border border-slate-300 px-2 py-1.5"
            [(ngModel)]="q"
        /></label>
        <label class="flex flex-col gap-1"
          >Role
          <select
            name="role"
            class="rounded-xl border border-slate-300 px-2 py-1.5"
            [(ngModel)]="role"
          >
            <option value="">Any</option>
            @for (r of roles; track r) {
              <option [value]="r">{{ r }}</option>
            }
          </select>
        </label>
        <button
          type="submit"
          class="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white"
        >
          Search
        </button>
      </form>
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
      <div class="relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table class="w-full min-w-[40rem] text-sm">
          <caption class="sr-only">
            Users
          </caption>
          <thead class="bg-slate-50 text-left text-slate-500">
            <tr>
              <th class="px-3 py-2 font-medium">User</th>
              <th class="px-3 py-2 font-medium">Role</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2 font-medium">Last sign-in</th>
              <th class="px-3 py-2"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (u of items(); track u.id) {
              <tr class="border-t border-slate-100">
                <td class="px-3 py-2">
                  <span class="font-medium">{{ u.fullName }}</span><br /><span
                    class="text-slate-500"
                    >{{ u.email }}</span
                  >
                </td>
                <td class="px-3 py-2">
                  @if (canChangeRoles && u.id !== myId) {
                    <label class="sr-only" [for]="'role-' + u.id">Role for {{ u.fullName }}</label>
                    <select
                      [id]="'role-' + u.id"
                      class="rounded-xl border border-slate-300 px-1 py-0.5"
                      [ngModel]="u.role"
                      (ngModelChange)="changeRole(u, $event)"
                    >
                      @for (r of roles; track r) {
                        <option [value]="r">{{ r }}</option>
                      }
                    </select>
                  } @else {
                    {{ u.role }}
                  }
                </td>
                <td class="px-3 py-2">
                  {{ u.status.toLowerCase().replace('_', ' ') }}
                  @if (u.lockedUntil) {
                    (locked)
                  }
                </td>
                <td class="px-3 py-2 tabular-nums">
                  {{ u.lastLoginAt ? (u.lastLoginAt | date: 'd MMM y') : '—' }}
                </td>
                <td class="px-3 py-2 text-right">
                  @if (u.id !== myId) {
                    @if (u.status === 'SUSPENDED') {
                      <button type="button" class="underline" (click)="setStatus(u, 'ACTIVE')">
                        Reactivate
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="text-red-700 underline"
                        (click)="setStatus(u, 'SUSPENDED')"
                      >
                        Suspend
                      </button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="px-3 py-6 text-slate-500">No users found.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <label class="flex max-w-md flex-col gap-1 text-sm"
        >Reason for suspending or reactivating (required)
        <input class="rounded-xl border border-slate-300 px-2 py-1.5" [(ngModel)]="reason" />
      </label>
    </section>
  `,
})
export class AdminUsers implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthService);
  protected readonly roles = ROLES;
  protected readonly canChangeRoles = this.auth.hasPermission('user:role_change');
  protected readonly myId = this.auth.user()?.id;
  protected q = '';
  protected role = '';
  protected reason = '';
  protected readonly items = signal<AdminUser[]>([]);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async load(): Promise<void> {
    this.items.set(
      (await this.api.users({ q: this.q.trim() || undefined, role: this.role || undefined })).items,
    );
  }

  protected async changeRole(u: AdminUser, role: Role): Promise<void> {
    this.error.set(null);
    try {
      await this.api.changeRole(u.id, role);
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
      await this.load();
    }
  }

  protected async setStatus(u: AdminUser, status: 'ACTIVE' | 'SUSPENDED'): Promise<void> {
    this.error.set(null);
    if (this.reason.trim().length < 3) {
      this.error.set('Enter a reason first (it is recorded in the audit log).');
      return;
    }
    try {
      await this.api.changeStatus(u.id, status, this.reason.trim());
      this.reason = '';
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
