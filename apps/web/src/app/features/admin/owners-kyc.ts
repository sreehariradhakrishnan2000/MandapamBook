import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminApi, type OwnerKycItem, type RevealedKyc } from '../../core/admin-api.service';
import { errorMessage } from '../../core/auth/auth.service';

@Component({
  selector: 'app-admin-owners-kyc',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-4 py-4">
      <a routerLink="/admin" class="tap w-fit text-sm text-brand-700 underline">← Admin</a>
      <h1 class="font-display text-3xl font-medium">Owner KYC</h1>
      <label class="text-sm"
        >Show
        <select
          class="ml-1 rounded-xl border border-slate-300 px-2 py-1.5"
          [(ngModel)]="status"
          (ngModelChange)="load()"
        >
          <option value="SUBMITTED">Awaiting review</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </label>
      @if (error()) {
        <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }

      <ul class="flex flex-col gap-3">
        @for (o of items(); track o.ownerId) {
          <li class="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p class="font-semibold">
              {{ o.businessName }}
              <span class="font-normal text-slate-500">· {{ o.fullName }} · {{ o.email }}</span>
            </p>
            <dl class="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
              <dt class="text-slate-500">PAN</dt>
              <dd class="font-mono">{{ revealed()[o.ownerId]?.pan ?? o.panMasked }}</dd>
              <dt class="text-slate-500">Account</dt>
              <dd class="font-mono">
                {{ revealed()[o.ownerId]?.bankAccountNumber ?? o.bankAccountMasked }}
              </dd>
              <dt class="text-slate-500">IFSC</dt>
              <dd class="font-mono">{{ o.ifsc }}</dd>
              <dt class="text-slate-500">GSTIN</dt>
              <dd class="font-mono">{{ o.gstin ?? '—' }}</dd>
            </dl>
            @if (o.kycRejectionReason) {
              <p class="mt-2 text-red-700">Rejected: {{ o.kycRejectionReason }}</p>
            }

            <div class="mt-3 flex flex-wrap items-end gap-2">
              @if (!revealed()[o.ownerId]) {
                <label class="flex flex-col gap-1"
                  >Reason for viewing full numbers
                  <input
                    class="rounded-xl border border-slate-300 px-2 py-1"
                    [(ngModel)]="purpose[o.ownerId]"
                    placeholder="e.g. match PAN card"
                  />
                </label>
                <button
                  type="button"
                  class="rounded-full border border-slate-300 px-3 py-1"
                  (click)="reveal(o)"
                >
                  Show full numbers
                </button>
              }
              @if (o.kycStatus === 'SUBMITTED') {
                <button
                  type="button"
                  class="rounded-full bg-leaf-600 px-3 py-1 font-semibold text-white"
                  (click)="verify(o)"
                >
                  Verify
                </button>
                <label class="flex flex-col gap-1"
                  >Rejection reason
                  <input
                    class="rounded-xl border border-slate-300 px-2 py-1"
                    [(ngModel)]="rejectReason[o.ownerId]"
                  />
                </label>
                <button
                  type="button"
                  class="rounded-full border border-red-300 px-3 py-1 text-red-700"
                  (click)="reject(o)"
                >
                  Reject
                </button>
              }
            </div>
          </li>
        } @empty {
          <li class="text-sm text-slate-500">No owners in this state.</li>
        }
      </ul>
      <p class="text-xs text-slate-500">
        Viewing full numbers is recorded in the audit log with your reason.
      </p>
    </section>
  `,
})
export class AdminOwnersKyc implements OnInit {
  private readonly api = inject(AdminApi);
  protected status = 'SUBMITTED';
  protected readonly items = signal<OwnerKycItem[]>([]);
  protected readonly revealed = signal<Record<string, RevealedKyc>>({});
  protected readonly error = signal<string | null>(null);
  protected purpose: Record<string, string> = {};
  protected rejectReason: Record<string, string> = {};

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async load(): Promise<void> {
    this.items.set((await this.api.owners(this.status || undefined)).items);
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected reveal(o: OwnerKycItem): Promise<void> {
    return this.run(async () => {
      const data = await this.api.revealKyc(o.ownerId, (this.purpose[o.ownerId] ?? '').trim());
      this.revealed.update((r) => ({ ...r, [o.ownerId]: data }));
    });
  }

  protected verify(o: OwnerKycItem): Promise<void> {
    return this.run(async () => {
      await this.api.decideKyc(o.ownerId, { decision: 'verify' });
      await this.load();
    });
  }

  protected reject(o: OwnerKycItem): Promise<void> {
    return this.run(async () => {
      await this.api.decideKyc(o.ownerId, {
        decision: 'reject',
        reason: (this.rejectReason[o.ownerId] ?? '').trim(),
      });
      await this.load();
    });
  }
}
