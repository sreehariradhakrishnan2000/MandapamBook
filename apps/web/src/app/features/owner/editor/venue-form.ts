import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  type AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import {
  type AuditoriumInput,
  type Coordinates,
  googleMapsPlaceUrl,
  parseCoordinates,
} from '@mandapambook/shared';
import { errorMessage } from '../../../core/auth/auth.service';
import { GeolocationService, LocationError } from '../../../core/geolocation.service';
import { type City, OwnerApi, type VenueDetail } from '../../../core/owner-api.service';
import { BUTTON_CLASS, FormField, INPUT_CLASS } from '../../../shared/form-field';

/** Empty, or coordinates (typed or from a Google Maps link) inside the area the API accepts. */
function locationValidator(control: AbstractControl<string>): ValidationErrors | null {
  const text = control.value.trim();
  if (!text) return null;
  const pin = parseCoordinates(text);
  if (!pin) return { location: true };
  const inIndia =
    pin.latitude >= 6 && pin.latitude <= 37 && pin.longitude >= 68 && pin.longitude <= 98;
  return inIndia ? null : { outsideIndia: true };
}

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
          for="location"
          label="Map location (optional)"
          hint="Paste the venue's link from Google Maps (Share → Copy link, or the address bar), or type latitude, longitude. Customers use it to find halls near them and get directions."
          [error]="locationProblem()"
        >
          <input
            id="location"
            formControlName="location"
            placeholder="e.g. 10.0261, 76.3084"
            [class]="inputClass"
            [attr.aria-invalid]="!!locationProblem()"
          />
        </app-form-field>
        <div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            class="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 font-medium hover:border-slate-400 disabled:opacity-60"
            [disabled]="locating()"
            (click)="useCurrentLocation()"
          >
            {{ locating() ? 'Finding you…' : 'Use my current location' }}
          </button>
          @if (pin(); as p) {
            <a
              [href]="previewUrl(p)"
              target="_blank"
              rel="noopener"
              class="tap text-brand-700 underline"
              >Check the pin on Google Maps</a
            >
          }
          @if (geoError()) {
            <span class="text-red-700" role="alert">{{ geoError() }}</span>
          }
        </div>
      </div>
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
        ><input type="checkbox" formControlName="sadyaPrepArea" class="size-4" /> Sadya preparation
        area on site</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><input type="checkbox" formControlName="cookingEquipment" class="size-4" /> Cooking
        equipment provided (vessels, stoves, burners)</label
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
  private readonly geo = inject(GeolocationService);
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
    location: ['', locationValidator],
    pincode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    description: [''],
    cateringPolicy: ['OUTSIDE_ALLOWED' as AuditoriumInput['cateringPolicy']],
    decorationPolicy: ['OUTSIDE_ALLOWED' as AuditoriumInput['decorationPolicy']],
    parkingCars: [0, Validators.min(0)],
    parkingTwoWheelers: [0, Validators.min(0)],
    guestRooms: [0, Validators.min(0)],
    advancePercent: [25, [Validators.min(10), Validators.max(100)]],
    hasGenerator: [false],
    sadyaPrepArea: [false],
    cookingEquipment: [false],
    instantBook: [true],
  });

  async ngOnInit(): Promise<void> {
    const v = this.venue();
    if (v) {
      this.form.patchValue({
        ...v,
        locality: v.locality ?? '',
        location:
          v.latitude !== null && v.longitude !== null ? `${v.latitude}, ${v.longitude}` : '',
      });
    }
    try {
      this.cities.set((await this.api.cities()).items);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load cities.'));
    }
  }

  protected readonly previewUrl = googleMapsPlaceUrl;
  protected readonly locating = signal(false);
  protected readonly geoError = signal<string | null>(null);

  /** The pin read from the location field, when it is valid. */
  protected pin(): Coordinates | null {
    const c = this.form.controls.location;
    return c.valid ? parseCoordinates(c.value) : null;
  }

  protected locationProblem(): string | null {
    const c = this.form.controls.location;
    if (!c.touched || c.valid) return null;
    return c.hasError('outsideIndia')
      ? 'That point is outside India. Check the link or the numbers.'
      : 'Could not read a location. Paste the full Google Maps link (short maps.app.goo.gl links do not include it) or type latitude, longitude.';
  }

  protected async useCurrentLocation(): Promise<void> {
    this.locating.set(true);
    this.geoError.set(null);
    try {
      const here = await this.geo.current({ precise: true });
      const round = (n: number) => Math.round(n * 1e6) / 1e6;
      const c = this.form.controls.location;
      c.setValue(`${round(here.latitude)}, ${round(here.longitude)}`);
      c.markAsTouched();
      c.markAsDirty();
    } catch (err) {
      this.geoError.set(
        err instanceof LocationError ? err.message : 'Could not find your location.',
      );
    } finally {
      this.locating.set(false);
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
      const { locality, location, ...rest } = this.form.getRawValue();
      const pin = parseCoordinates(location);
      const body: AuditoriumInput = {
        ...rest,
        ...(locality.trim() ? { locality } : {}),
        ...(pin ? { latitude: pin.latitude, longitude: pin.longitude } : {}),
      };
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
