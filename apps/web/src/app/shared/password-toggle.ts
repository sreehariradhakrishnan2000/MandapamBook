import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/**
 * Show/hide button for a password input. Place it right after the input inside a
 * `relative` wrapper and give the input `pr-12` so text never runs under the button:
 *
 *   <div class="relative">
 *     <input #pw id="password" type="password" class="... pr-12" />
 *     <app-password-toggle [input]="pw" />
 *   </div>
 *
 * The eye gets a slash drawn across it (and the pupil closes) while the password is
 * visible. Motion is skipped for people who prefer reduced motion.
 */
@Component({
  selector: 'app-password-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-y-0 right-1.5 flex items-center' },
  template: `
    <button
      type="button"
      class="group flex size-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-90 motion-safe:transition-transform"
      [attr.aria-controls]="input().id || null"
      [attr.aria-pressed]="visible()"
      [attr.title]="visible() ? 'Hide password' : 'Show password'"
      (click)="toggle()"
    >
      <span class="sr-only">Show password</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        class="size-5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle
          cx="12"
          cy="12"
          r="2.75"
          class="origin-center motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
          [class.scale-0]="visible()"
        />
        <path
          d="M4 4 20 20"
          pathLength="1"
          stroke-dasharray="1"
          class="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-300 motion-safe:ease-out"
          [attr.stroke-dashoffset]="visible() ? 0 : 1"
        />
      </svg>
    </button>
  `,
})
export class PasswordToggle {
  readonly input = input.required<HTMLInputElement>();
  protected readonly visible = signal(false);

  protected toggle(): void {
    const el = this.input();
    const next = !this.visible();
    // Changing the type keeps the value; keep the caret where the user left it.
    const { selectionStart, selectionEnd } = el;
    el.type = next ? 'text' : 'password';
    if (document.activeElement === el && selectionStart !== null) {
      el.setSelectionRange(selectionStart, selectionEnd);
    }
    this.visible.set(next);
  }
}
