import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures.js';
import { setSiteSwitch } from '../support/db.js';
import { waitForMail } from '../support/mail.js';
import { PASSWORD, VENUE_NAME, signIn, uniqueEmail } from '../support/journey.js';

/** The API reuses a switch's value for 5 seconds; wait that out after changing one. */
const SWITCH_CACHE_MS = 5_500;

const OFF = { enabled: false, message: '', until: null, scheduledFrom: null, scheduledTo: null };

test.afterEach(async () => {
  // Never leave the site closed for the next test.
  await setSiteSwitch('maintenance', OFF);
  await setSiteSwitch('bookings_pause', { paused: false, message: '' });
});

/** From the home page to the venue's booking page for its first hall. */
async function openBookingPage(page: Page): Promise<void> {
  await page.goto('/search');
  await page
    .getByRole('link', { name: new RegExp(VENUE_NAME) })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: VENUE_NAME })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Book', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /^Book / })).toBeVisible();
}

test('visitors see the maintenance page, and the site comes back by itself', async ({ page }) => {
  test.setTimeout(120_000);
  await setSiteSwitch('maintenance', {
    ...OFF,
    enabled: true,
    message: 'Upgrading payments. Back in an hour.',
  });
  await page.waitForTimeout(SWITCH_CACHE_MS);

  await page.goto('/search');
  await expect(page.getByRole('heading', { name: "We're making things better" })).toBeVisible();
  await expect(page.getByText('Upgrading payments. Back in an hour.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Staff sign in' })).toBeVisible();

  // Maintenance ends: the page checks every 30 seconds and reloads the page they were on.
  await setSiteSwitch('maintenance', OFF);
  await expect(page.getByRole('heading', { name: "We're making things better" })).toBeHidden({
    timeout: 45_000,
  });
  await expect(page).toHaveURL(/\/search/);
});

test('a bookings pause stops holds but keeps the site browsable', async ({ page }) => {
  await setSiteSwitch('bookings_pause', { paused: true, message: 'Payments are being fixed.' });
  await page.waitForTimeout(SWITCH_CACHE_MS);

  await openBookingPage(page);
  await expect(page.getByText('New bookings are paused.').first()).toBeVisible();
  await expect(page.getByText('Payments are being fixed.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Hold this date/ })).toHaveCount(0);
});

test('resending the verification email brings the customer back to the booking, verified', async ({
  page,
}) => {
  const email = uniqueEmail('resend');
  await page.goto('/register');
  await page.getByLabel('Book a hall').check();
  await page.getByLabel('Full name').fill('Lakshmi Nair');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel(/I agree to the Terms of Use/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await signIn(page, email);

  await openBookingPage(page);
  const bookingUrl = new URL(page.url());
  await expect(page.getByText('Verify your email to book')).toBeVisible();
  await page.getByRole('button', { name: 'Resend verification email' }).click();
  await expect(page.getByText('Open the newest email')).toBeVisible();

  // The resent email's link carries this booking page.
  let link = '';
  await expect
    .poll(
      async () => {
        const mail = await waitForMail(email, 'verify_email', 5_000);
        link =
          mail.text
            .split(/\s+/)
            .find((w) => w.includes('/verify-email?') && w.includes('&next=')) ?? '';
        return link;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');

  await page.goto(link);
  await expect(page).toHaveURL(new RegExp(`${bookingUrl.pathname}.*verified=1`));
  await expect(page.getByText('Email verified. You can hold this date now.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hold this date' })).toBeVisible();
});
