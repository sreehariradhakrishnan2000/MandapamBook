import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SearchForm } from './search-form';

@Component({
  selector: 'app-home',
  imports: [SearchForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 via-brand-700 to-brand-900 px-6 pt-10 pb-24 text-brand-50 shadow-xl ring-1 ring-gold-500/40 sm:px-10 sm:pt-14"
    >
      <!-- Hanging marigold strings across the top of the stage. -->
      <div class="toran absolute inset-x-0 top-0 opacity-90" aria-hidden="true"></div>

      <div class="relative grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <p class="font-display text-lg tracking-wide text-gold-200">Shubh Vivah</p>
          <h1
            class="mt-2 max-w-xl font-display text-4xl leading-tight font-bold text-balance text-white sm:text-5xl"
          >
            Book the right mandapam for your muhurtham
          </h1>
          <p class="mt-4 max-w-lg text-lg text-brand-100">
            Compare kalyana mandapams and convention halls by city, guest capacity, catering policy
            and price, then hold your date while you pay.
          </p>
        </div>

        <!-- Decorative mandap: carved pillars, a domed arch, garlands and diyas. -->
        <svg
          aria-hidden="true"
          viewBox="0 0 360 260"
          class="mx-auto hidden w-full max-w-sm drop-shadow-xl sm:block"
        >
          <defs>
            <linearGradient id="gold" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#f3d27a" />
              <stop offset="1" stop-color="#c49a2c" />
            </linearGradient>
          </defs>
          <path d="M40 236h280l-14 14H54z" fill="url(#gold)" />
          <rect x="66" y="224" width="228" height="12" rx="3" fill="#f3d27a" />
          <path d="M60 96 Q180 -10 300 96 Z" fill="url(#gold)" />
          <path d="M80 96 Q180 18 280 96" fill="none" stroke="#8a1c33" stroke-width="4" />
          <!-- Kalash crowning the dome. -->
          <path d="M172 30h16l-2 4h-12z" fill="#f3d27a" />
          <path d="M171 34h18c2 4 1 9-3 11h-12c-4-2-5-7-3-11z" fill="#e89b12" />
          <path d="M176 30c-1-6 2-10 4-12 2 2 5 6 4 12z" fill="#2d6a3e" />
          <circle cx="180" cy="21" r="3" fill="#f6b73c" />
          <rect x="56" y="94" width="248" height="12" rx="3" fill="#c49a2c" />
          <!-- Marigold strands (lari) hanging from the beam, ending in small bells. -->
          @for (s of strands; track s.x) {
            <line
              [attr.x1]="s.x"
              y1="106"
              [attr.x2]="s.x"
              [attr.y2]="106 + s.len"
              stroke="#f6b73c"
              stroke-width="4.5"
              stroke-dasharray="4 2.5"
            />
            <line
              [attr.x1]="s.x"
              y1="109"
              [attr.x2]="s.x"
              [attr.y2]="106 + s.len"
              stroke="#e8651a"
              stroke-width="4.5"
              stroke-dasharray="2.5 4"
            />
            <path [attr.d]="'M' + (s.x - 3) + ' ' + (108 + s.len) + 'h6l-1 5h-4z'" fill="#f3d27a" />
          }
          @for (x of pillars; track x) {
            <rect [attr.x]="x" y="106" width="18" height="118" rx="3" fill="url(#gold)" />
            <rect [attr.x]="x - 4" y="106" width="26" height="8" rx="2" fill="#f3d27a" />
            <rect [attr.x]="x - 4" y="216" width="26" height="8" rx="2" fill="#f3d27a" />
          }
          @for (g of garlands; track g) {
            <path
              [attr.d]="'M' + g + ' 106 Q' + (g + 30) + ' 140 ' + (g + 60) + ' 106'"
              fill="none"
              stroke="#e8651a"
              stroke-width="5"
              stroke-dasharray="1 7"
              stroke-linecap="round"
            />
            <path
              [attr.d]="'M' + g + ' 106 Q' + (g + 30) + ' 132 ' + (g + 60) + ' 106'"
              fill="none"
              stroke="#f6b73c"
              stroke-width="5"
              stroke-dasharray="1 7"
              stroke-dashoffset="4"
              stroke-linecap="round"
            />
          }
          <path d="M150 200h60l-6 12h-48z" fill="#e89b12" />
          <path d="M180 180c6 8 6 14 0 20-6-6-6-12 0-20z" fill="#f6b73c" />
          <path d="M180 188c3 4 3 7 0 10-3-3-3-6 0-10z" fill="#fff1cc" />
          @for (d of diyas; track d) {
            <path [attr.d]="'M' + (d - 10) + ' 224h20l-4 6h-12z'" fill="#e89b12" />
            <path [attr.d]="'M' + d + ' 212c3 4 3 7 0 10-3-3-3-6 0-10z'" fill="#f6b73c" />
          }
        </svg>
      </div>
    </section>

    <div class="relative z-10 -mt-14 px-2 sm:px-6">
      <app-search-form />
    </div>

    <div class="ornament-divider mt-14 mb-8" aria-hidden="true">
      <svg viewBox="0 0 40 20" class="h-5 w-10">
        <path
          d="M20 2c4 4 4 10 0 16-4-6-4-12 0-16zM20 18c-6-1-11-5-12-10 5 0 10 4 12 10zM20 18c6-1 11-5 12-10-5 0-10 4-12 10z"
          fill="currentColor"
        />
      </svg>
    </div>

    <section aria-labelledby="why-heading">
      <h2 id="why-heading" class="text-center font-display text-3xl font-bold text-brand-700">
        Everything for the big day, in one place
      </h2>
      <ul class="mt-8 grid gap-5 sm:grid-cols-3">
        @for (f of features; track f.title) {
          <li class="rounded-2xl border border-gold-500/40 bg-white/90 p-6 text-center shadow-sm">
            <span
              class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-marigold-100 text-2xl"
              aria-hidden="true"
              >{{ f.icon }}</span
            >
            <h3 class="mt-4 font-display text-xl font-bold text-brand-700">{{ f.title }}</h3>
            <p class="mt-2 text-slate-600">{{ f.text }}</p>
          </li>
        }
      </ul>
    </section>
  `,
})
export class Home {
  protected readonly pillars = [78, 264];
  protected readonly garlands = [96, 150, 204];
  protected readonly diyas = [110, 250];
  protected readonly strands = [
    { x: 106, len: 52 },
    { x: 122, len: 34 },
    { x: 238, len: 34 },
    { x: 254, len: 52 },
  ];
  protected readonly features = [
    {
      icon: '🪔',
      title: 'Verified mandapams',
      text: 'Every venue and owner is reviewed before it is listed, with real photos and capacities.',
    },
    {
      icon: '📅',
      title: 'Muhurtham-ready dates',
      text: 'See which halls are free for your auspicious date and slot, morning or evening.',
    },
    {
      icon: '🌼',
      title: 'Hold, then pay securely',
      text: 'Hold your date while you pay the advance. Clear cancellation terms, invoices included.',
    },
  ];
}
