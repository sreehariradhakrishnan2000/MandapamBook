import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';
import { WEB_URL } from '../env.js';
import { linkIn, waitForMail } from './mail.js';

export const PASSWORD = 'mandapam e2e passphrase 2026';

/** Shared between the journeys in this run (the owner journey runs first). */
export const VENUE_NAME = 'Sree Krishna Kalyana Mandapam';

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;

/** Registers through the UI and opens the verification link from the email. */
export async function registerAndVerify(
  page: Page,
  opts: { email: string; fullName: string; owner?: boolean },
): Promise<void> {
  await page.goto('/register');
  if (opts.owner) await page.getByLabel('List my venue').check();
  else await page.getByLabel('Book a hall').check();
  await page.getByLabel('Full name').fill(opts.fullName);
  await page.getByLabel('Email').fill(opts.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel(/I agree to the Terms of Use/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const mail = await waitForMail(opts.email, 'verify_email');
  await page.goto(linkIn(mail, `${WEB_URL}/verify-email`));
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Fails on serious or critical WCAG 2.1 A/AA violations. */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const describe = (n: { target: unknown[]; failureSummary?: string | undefined }) =>
    `${n.target.join(' ')} (${(n.failureSummary ?? '').split(/\r?\n/).at(-1)?.trim() ?? ''})`;
  expect(
    serious.map((v) => `${v.id}: ${v.help} at ${v.nodes.map(describe).join('; ')}`),
    `accessibility problems on ${label}`,
  ).toEqual([]);
}

/** A Wednesday at least `minDays` ahead, as YYYY-MM-DD in IST. */
export function futureWednesday(minDays: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  for (let i = minDays; ; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    if (date.getUTCDay() === 3) return date.toISOString().slice(0, 10);
  }
}
