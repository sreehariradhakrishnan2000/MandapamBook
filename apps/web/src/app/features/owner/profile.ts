import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IFSC_PATTERN, type OwnerProfileView, PAN_PATTERN } from '@mandapambook/shared';
import { errorMessage } from '../../core/auth/auth.service';
import { OwnerApi } from '../../core/owner-api.service';
import { BUTTON_CLASS, FormField, INPUT_CLASS } from '../../shared/form-field';

@Component({
  selector: 'app-owner-profile',
  imports: [ReactiveFormsModule, RouterLink, FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-lg py-4">
      <a routerLink=".." class="text-sm text-brand-700 underline">← My venues</a>
      <h1 class="mt-2 font-display text-3xl font-medium">Business & payout details</h1>
      <p class="mt-1 text-sm text-slate-600">
        Needed to receive payouts. PAN and account numbers are encrypted and only the last four
        digits are ever shown.
      </p>

      @if (current(); as p) {
        @if (p.panMasked) {
          <dl
            class="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-white p-4 text-sm ring-1 ring-slate-200"
          >
            <dt class="text-slate-500">PAN</dt>
            <dd class="font-mono">{{ p.panMasked }}</dd>
            <dt class="text-slate-500">Account</dt>
            <dd class="font-mono">{{ p.bankAccountMasked }}</dd>
            <dt class="text-slate-500">IFSC</dt>
            <dd class="font-mono">{{ p.ifsc }}</dd>
            <dt class="text-slate-500">Status</dt>
            <dd>
              {{
                p.kycStatus === 'VERIFIED'
                  ? 'Verified'
                  : p.kycStatus === 'SUBMITTED'
                    ? 'Awaiting review'
                    : p.kycStatus
              }}
            </dd>
          </dl>
          @if (p.kycStatus === 'REJECTED' && p.kycRejectionReason) {
            <p class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              We could not verify these details: {{ p.kycRejectionReason }}
            </p>
          }
          <p class="mt-2 text-sm text-slate-600">To change these, enter all details again below.</p>
        }
      }

      <form [formGroup]="form" (ngSubmit)="save()" class="mt-6 flex flex-col gap-4" novalidate>
        @if (message()) {
          <p class="rounded-xl bg-leaf-600/10 px-3 py-2 text-sm text-leaf-600" role="status">
            {{ message() }}
          </p>
        }
        @if (error()) {
          <p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {{ error() }}
          </p>
        }
        <app-form-field for="businessName" label="Business or owner name">
          <input id="businessName" formControlName="businessName" [class]="inputClass" />
        </app-form-field>
        <app-form-field
          for="pan"
          label="PAN"
          hint="10 characters, e.g. ABCPE1234F"
          [error]="bad('pan') ? 'Enter a valid PAN' : null"
        >
          <input
            id="pan"
            formControlName="pan"
            autocomplete="off"
            class="uppercase"
            [class]="inputClass"
            [attr.aria-invalid]="bad('pan')"
          />
        </app-form-field>
        <app-form-field
          for="gstin"
          label="GSTIN (optional)"
          hint="15 characters; must contain your PAN"
        >
          <input
            id="gstin"
            formControlName="gstin"
            autocomplete="off"
            class="uppercase"
            [class]="inputClass"
          />
        </app-form-field>
        <app-form-field for="bankAccountName" label="Account holder name">
          <input id="bankAccountName" formControlName="bankAccountName" [class]="inputClass" />
        </app-form-field>
        <app-form-field
          for="bankAccountNumber"
          label="Bank account number"
          [error]="bad('bankAccountNumber') ? '9 to 18 digits' : null"
        >
          <input
            id="bankAccountNumber"
            formControlName="bankAccountNumber"
            inputmode="numeric"
            autocomplete="off"
            [class]="inputClass"
            [attr.aria-invalid]="bad('bankAccountNumber')"
          />
        </app-form-field>
        <app-form-field
          for="ifsc"
          label="IFSC"
          hint="e.g. SBIN0001234"
          [error]="bad('ifsc') ? 'Enter a valid IFSC' : null"
        >
          <input
            id="ifsc"
            formControlName="ifsc"
            autocomplete="off"
            class="uppercase"
            [class]="inputClass"
            [attr.aria-invalid]="bad('ifsc')"
          />
        </app-form-field>
        <button type="submit" [class]="buttonClass" [disabled]="busy()">Save details</button>
      </form>
    </section>
  `,
})
export class OwnerProfile implements OnInit {
  private readonly api = inject(OwnerApi);
  protected readonly inputClass = INPUT_CLASS;
  protected readonly buttonClass = BUTTON_CLASS;
  protected readonly current = signal<OwnerProfileView | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);

  private readonly upper = (re: RegExp) => Validators.pattern(new RegExp(re.source, 'i'));
  protected readonly form = inject(NonNullableFormBuilder).group({
    businessName: ['', [Validators.required, Validators.minLength(2)]],
    pan: ['', [Validators.required, this.upper(PAN_PATTERN)]],
    gstin: [''],
    bankAccountName: ['', Validators.required],
    bankAccountNumber: ['', [Validators.required, Validators.pattern(/^\d{9,18}$/)]],
    ifsc: ['', [Validators.required, this.upper(IFSC_PATTERN)]],
  });

  async ngOnInit(): Promise<void> {
    const p = await this.api.profile();
    this.current.set(p);
    this.form.patchValue({
      businessName: p.businessName,
      bankAccountName: p.bankAccountName ?? '',
      gstin: p.gstin ?? '',
      ifsc: p.ifsc ?? '',
    });
  }

  protected bad(name: 'pan' | 'bankAccountNumber' | 'ifsc'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected async save(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      const { gstin, ...rest } = this.form.getRawValue();
      const saved = await this.api.saveProfile(gstin.trim() ? { ...rest, gstin } : rest);
      this.current.set(saved);
      this.form.patchValue({ pan: '', bankAccountNumber: '' });
      this.form.markAsUntouched();
      this.message.set('Saved. Our team will verify your details.');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
