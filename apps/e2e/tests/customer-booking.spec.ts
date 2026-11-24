import { expect, test } from '../support/fixtures.js';
import { waitForMail } from '../support/mail.js';
import {
  VENUE_NAME,
  expectAccessible,
  futureWednesday,
  registerAndVerify,
  signIn,
  uniqueEmail,
} from '../support/journey.js';

test('a customer searches, holds a date, pays in test mode and gets a confirmation', async ({
  page,
}) => {
  const email = uniqueEmail('customer');
  const date = futureWednesday(45);

  await test.step('customer registers and verifies their email', async () => {
    await registerAndVerify(page, { email, fullName: 'Anjali Menon' });
    await signIn(page, email);
  });

  await test.step('search finds the approved venue', async () => {
    await page.goto('/');
    await expect(page.getByText('TEST MODE: payments are simulated')).toBeVisible();
    const form = page
      .getByRole('search', { name: 'Find a hall' })
      .or(page.getByLabel('Find a hall'));
    await form.getByLabel('City').selectOption('kochi');
    await form.getByLabel('Date').fill(date);
    await form.getByLabel('Slot').selectOption('FULL_DAY');
    await form.getByLabel('Guests').fill('500');
    await form.getByRole('button').first().click();
    await expect(page).toHaveURL(/\/search\?/);
    await expectAccessible(page, 'search results');
    await page.getByRole('link', { name: new RegExp(VENUE_NAME) }).click();
    await expect(page.getByRole('heading', { level: 1, name: VENUE_NAME })).toBeVisible();
    await expectAccessible(page, 'venue page');
  });

  let refCode = '';
  await test.step('customer holds the date with a 10-minute hold', async () => {
    // Exact and inside main: "My bookings" in the footer would otherwise match last.
    await page.getByRole('main').getByRole('link', { name: 'Book', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: /Book Main Hall/ })).toBeVisible();
    await expect(page.getByLabel('Guests')).toHaveValue('500');
    await page.getByRole('button', { name: 'Hold this date' }).click();
    const hold = page.getByRole('status').filter({ hasText: 'Your date is on hold' });
    await expect(hold).toBeVisible();
    refCode = (await hold.textContent())!.match(/MB-[A-Z0-9]+/)![0];
    await expect(hold).toContainText(/\d+:\d{2}/);
  });

  await test.step('customer pays the advance on the test checkout', async () => {
    await page.getByRole('button', { name: /^Pay ₹[\d,]+(\.\d{2})? now$/ }).click();
    await expect(page).toHaveURL(/\/api\/v1\/payments\/mock\/checkout\//);
    await page.getByRole('button', { name: 'Pay success', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
  });

  await test.step('booking is confirmed with an invoice in the email', async () => {
    await page.goto('/account/bookings');
    await expect(page.getByText(refCode)).toBeVisible();
    await page.getByText(refCode).click();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download invoice (PDF)' }).click();
    expect((await download).suggestedFilename()).toMatch(/^MB-\d{4}-\d{2}-\d{6}\.pdf$/);
    await expectAccessible(page, 'booking detail');

    // The worker turns the confirmation into an email with the invoice attached.
    const mail = await waitForMail(email, 'booking_confirmed', 90_000);
    expect(mail.subject).toContain(refCode);
    expect(mail.attachments?.[0]?.filename).toMatch(/^MB-\d{4}-\d{2}-\d{6}\.pdf$/);
  });
});
