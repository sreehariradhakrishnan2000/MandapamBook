import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { AuditoriumInput } from '@mandapambook/shared';
import { errorMessage } from '../../../core/auth/auth.service';
import { type City, OwnerApi, type VenueDetail } from '../../../core/owner-api.service';
import { BUTTON_CLASS, FormField, INPUT_CLASS } from '../../../shared/form-field';

/** Venue basics, used both to create a draft and to edit an existing listing. */
@Component({
  selector: 'app-venue-form',
  imports: [ReactiveFormsModule, FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="grid gap-4 sm:grid-cols-2" novalidate>
      @if (error()) {
        <p class="sm:col-span-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {{ error() }}
        </p>
      }
      @if (showSaved()) {
        <p
          class="sm:col-span-2 rounded-xl bg-leaf-600/10 px-3 py-2 text-sm text-leaf-600"
          role="status"
        >
          Saved.
        </p>
      }
      <div class="sm:col-span-2">
        <app-form-field
          for="name"
          label="Venue name"
          [error]="bad('name') ? 'At least 3 characters' : null"
        >
          <input
            id="name"
            formControlName="name"
            [class]="inputClass"
            [attr.aria-invalid]="bad('name')"
          />
        </app-form-field>
      </div>
      <app-form-field for="cityId" label="City" [error]="bad('cityId') ? 'Choose a city' : null">
        <select
          id="cityId"
          formControlName="cityId"
          [class]="inputClass"
          [attr.aria-invalid]="bad('cityId')"
        >
          <option value="">Choose a city</option>
          @for (c of cities(); track c.id) {
            <option [value]="c.id">{{ c.name }}, {{ c.state }}</option>
          }
        </select>
      </app-form-field>
      <app-form-field
        for="pincode"
        label="PIN code"
        [error]="bad('pincode') ? '6-digit PIN code' : null"
      >
        <input
          id="pincode"
          formControlName="pincode"
          inputmode="numeric"
          maxlength="6"
          [class]="inputClass"
          [attr.aria-invalid]="bad('pincode')"
        />
      </app-form-field>
      <div class="sm:col-span-2">
        <app-form-field for="addressLine" label="Address">
          <input
            id="addressLine"
            formControlName="addressLine"
            autocomplete="street-address"
            [class]="inputClass"
          />
        </app-form-field>
      </div>
      <app-form-field for="locality" label="Locality (optional)">
        <input id="locality" formControlName="locality" [class]="inputClass" />
      </app-form-field>
      <div class="sm:col-span-2">
        <app-form-field
          for="description"
          label="Description"
          hint="What makes the venue special: stage, dining, access, nearby temples."
        >
          <textarea
            id="description"
            formControlName="description"
            rows="4"
            [class]="inputClass"
          ></textarea>
        </app-form-field>
      </div>
      <app-form-field for="cateringPolicy" label="Catering">
        <select id="cateringPolicy" formControlName="cateringPolicy" [class]="inputClass">
          <option value="IN_HOUSE_ONLY">In-house caterer only</option>
          <option value="OUTSIDE_ALLOWED">Outside caterers allowed</option>
          <option value="NO_CATERING">No catering facility</option>
        </select>
      </app-form-field>
      <app-form-field for="decorationPolicy" label="Decoration">
        <select id="decorationPolicy" formControlName="decorationPolicy" [class]="inputClass">
          <option value="IN_HOUSE_ONLY">In-house decorator only</option>
          <option value="OUTSIDE_ALLOWED">Outside decorators allowed</option>
          <option value="NOT_ALLOWED">Decoration not allowed</option>
        </select>
      </app-form-field>
      <app-form-field for="parkingCars" label="Car parking (spaces)">
        <input
          id="parkingCars"
          type="number"
          min="0"
          formControlName="parkingCars"
          [class]="inputClass"
        />
      </app-form-field>
      <app-form-field for="parkingTwoWheelers" label="Two-wheeler parking">
        <input
          id="parkingTwoWheelers"
          type="number"
          min="0"
          formControlName="parkingTwoWheelers"
          [class]="inputClass"
        />
      </app-form-field>
      <app-form-field for="guestRooms" label="Rooms for guests">
        <input
          id="guestRooms"
          type="number"
          min="0"
          formControlName="guestRooms"
          [class]="inputClass"
        />
      </app-form-field>
      <app-form-field
        for="advancePercent"
        label="Advance collected online (%)"
        hint="10 to 100. The rest is paid at the venue."
      >
        <input
          id="advancePercent"
          type="number"
          min="10"
          max="100"
          formControlName="advancePercent"
          [class]="inputClass"
        />
      </app-form-field>
      <label class="flex items-center gap-2 text-sm"
        ><input type="checkbox" formControlName="hasGenerator" class="size-4" /> Generator backup
        available</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><input type="checkbox" formControlName="instantBook" class="size-4" /> Confirm bookings
        instantly (otherwise I approve each one)</label
      >
      <div class="sm:col-span-2">
        <button type="submit" [class]="buttonClass" [disabled]="busy()">
          {{ venue() ? 'Save changes' : 'Create draft' }}
        </button>
      </div>
    </form>
  `,
})
export class VenueForm implements OnInit {
  private readonly api = inject(OwnerApi);
  readonly venue = input<VenueDetail | null>(null);
  readonly saved = output<{ id: string }>();

  protected readonly inputClass = INPUT_CLASS;
  protected readonly buttonClass = BUTTON_CLASS;
  protected readonly cities = signal<City[]>([]);
  protected readonly busy = signal(false);
  protected readonly showSaved = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]],
    cityId: ['', Validators.required],
    addressLine: ['', [Validators.required, Validators.minLength(5)]],
    locality: [''],
    pincode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    description: [''],
    cateringPolicy: ['OUTSIDE_ALLOWED' as AuditoriumInput['cateringPolicy']],
    decorationPolicy: ['OUTSIDE_ALLOWED' as AuditoriumInput['decorationPolicy']],
    parkingCars: [0, Validators.min(0)],
    parkingTwoWheelers: [0, Validators.min(0)],
    guestRooms: [0, Validators.min(0)],
    advancePercent: [25, [Validators.min(10), Validators.max(100)]],
    hasGenerator: [false],
    instantBook: [true],
  });

  async ngOnInit(): Promise<void> {
    const v = this.venue();
    if (v) this.form.patchValue({ ...v, locality: v.locality ?? '' });
    try {
      this.cities.set((await this.api.cities()).items);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load cities.'));
    }
  }

  protected bad(name: 'name' | 'cityId' | 'pincode'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected async save(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    this.showSaved.set(false);
    try {
      const { locality, ...rest } = this.form.getRawValue();
      const body: AuditoriumInput = locality.trim() ? { ...rest, locality } : rest;
      const v = this.venue();
      const result = v ? await this.api.updateVenue(v.id, body) : await this.api.createVenue(body);
      this.showSaved.set(true);
      this.saved.emit({ id: result.id });
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
