import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Label + control + hint/error, with the ids wired for screen readers. */
@Component({
  selector: 'app-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1">
      <label [attr.for]="for()" class="text-sm font-medium text-slate-800">{{ label() }}</label>
      <ng-content />
      @if (error()) {
        <p [id]="for() + '-error'" class="text-sm text-red-700" role="alert">{{ error() }}</p>
      } @else if (hint()) {
        <p [id]="for() + '-hint'" class="text-sm text-slate-500">{{ hint() }}</p>
      }
    </div>
  `,
})
export class FormField {
  readonly for = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input<string>();
  readonly error = input<string | null>();
}

export const INPUT_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 aria-[invalid=true]:border-red-600';

export const BUTTON_CLASS =
  'inline-flex w-full items-center justify-center rounded-md bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';
