import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/auth/auth.service';
import { OwnerApi, type StaffMember, type VenueSummary } from '../../core/owner-api.service';

@Component({
  selector: 'app-owner-staff',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto flex max-w-2xl flex-col gap-5 py-4">
      <a routerLink=".." class="text-sm text-brand-700 underline">← My venues</a>
      <h1 class="font-display text-2xl font-bold">Staff</h1>
      <p class="text-sm text-slate-600">
        Staff can view bookings and manage the calendar. They can't change prices, payouts or
        listings.
      </p>
      @if (error()) {
        <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
      @if (message()) {
        <p class="rounded-md bg-leaf-600/10 px-3 py-2 text-sm text-leaf-600" role="status">
          {{ message() }}
        </p>
      }

      <ul class="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
        @for (s of staff(); track s.userId) {
          <li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span
              ><span class="font-medium">{{ s.fullName }}</span> · {{ s.email }}
              <span class="text-slate-500"
                >·
                {{
                  s.auditoriumIds.length ? s.auditoriumIds.length + ' venue(s)' : 'all venues'
                }}</span
              ></span
            >
            <button type="button" class="text-red-700 underline" (click)="remove(s)">Remove</button>
          </li>
        } @empty {
          <li class="px-4 py-3 text-sm text-slate-500">No staff yet.</li>
        }
      </ul>

      <form
        class="flex flex-col gap-3 rounded-md border border-dashed border-slate-300 p-4 text-sm"
        (ngSubmit)="invite()"
      >
        <h2 class="font-semibold">Invite a staff member</h2>
        <label class="flex flex-col gap-1"
          >Full name<input
            name="fullName"
            required
            class="rounded-md border border-slate-300 px-2 py-1.5"
            [(ngModel)]="fullName"
        /></label>
        <label class="flex flex-col gap-1"
          >Email<input
            name="email"
            type="email"
            required
            class="rounded-md border border-slate-300 px-2 py-1.5"
            [(ngModel)]="email"
        /></label>
        <fieldset class="flex flex-col gap-1">
          <legend>Venues (leave all unticked for every venue)</legend>
          @for (v of venues(); track v.id) {
            <label class="flex items-center gap-2"
              ><input
                type="checkbox"
                class="size-4"
                [checked]="chosen.has(v.id)"
                (change)="toggle(v.id)"
              />
              {{ v.name }}</label
            >
          }
        </fieldset>
        <button
          type="submit"
          class="w-fit rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white"
        >
          Send invitation
        </button>
      </form>
    </section>
  `,
})
export class OwnerStaff implements OnInit {
  private readonly api = inject(OwnerApi);
  protected readonly staff = signal<StaffMember[]>([]);
  protected readonly venues = signal<VenueSummary[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected fullName = '';
  protected email = '';
  protected chosen = new Set<string>();

  async ngOnInit(): Promise<void> {
    const [staff, venues] = await Promise.all([this.api.staff(), this.api.venues()]);
    this.staff.set(staff.items);
    this.venues.set(venues.items);
  }

  protected toggle(id: string): void {
    if (this.chosen.has(id)) this.chosen.delete(id);
    else this.chosen.add(id);
  }

  protected async invite(): Promise<void> {
    this.error.set(null);
    this.message.set(null);
    try {
      await this.api.inviteStaff(this.email.trim(), this.fullName.trim(), [...this.chosen]);
      this.message.set(
        `Invitation sent to ${this.email}. They'll choose a password from the email.`,
      );
      this.fullName = '';
      this.email = '';
      this.chosen = new Set();
      this.staff.set((await this.api.staff()).items);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async remove(s: StaffMember): Promise<void> {
    await this.api.removeStaff(s.userId);
    this.staff.set(this.staff().filter((x) => x.userId !== s.userId));
    this.message.set(`${s.fullName} no longer has access.`);
  }
}
