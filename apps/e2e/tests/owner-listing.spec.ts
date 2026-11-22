import { expect, test } from '../support/fixtures.js';
import { addReadyPhotos } from '../support/db.js';
import {
  VENUE_NAME,
  expectAccessible,
  registerAndVerify,
  signIn,
  uniqueEmail,
} from '../support/journey.js';

test('an owner lists a venue and an admin approves it', async ({ page, browser }) => {
  const ownerEmail = uniqueEmail('owner');
  const business = 'Sree Krishna Events';

  await test.step('owner registers and verifies their email', async () => {
    await registerAndVerify(page, { email: ownerEmail, fullName: 'Ravi Krishnan', owner: true });
    await signIn(page, ownerEmail);
  });

  await test.step('owner adds PAN and bank details', async () => {
    await page.goto('/owner/profile');
    await page.getByLabel('Business or owner name').fill(business);
    await page.getByLabel('PAN', { exact: true }).fill('ABCPK1234F');
    await page.getByLabel('Account holder name').fill('Ravi Krishnan');
    await page.getByLabel('Bank account number').fill('123456789012');
    await page.getByLabel('IFSC').fill('SBIN0001234');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Saved. Our team will verify your details.')).toBeVisible();
    await expectAccessible(page, 'owner profile');
  });

  let venueId = '';
  await test.step('owner creates a draft venue', async () => {
    await page.goto('/owner/venues/new');
    await page.getByLabel('Venue name').fill(VENUE_NAME);
    await page.getByLabel('City').selectOption({ label: 'Kochi, Kerala' });
    await page.getByLabel('PIN code').fill('682016');
    await page.getByLabel('Address').fill('MG Road, Ernakulam');
    await page.getByLabel('Description').fill('Air-conditioned hall for 800 guests near MG Road.');
    await page.getByLabel('Catering').selectOption('OUTSIDE_ALLOWED');
    await page.getByLabel('Decoration').selectOption('OUTSIDE_ALLOWED');
    await page.getByLabel('Advance collected online (%)').fill('25');
    await page.getByLabel(/Confirm bookings\s+instantly/).check();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/owner\/venues\/[0-9a-f-]{36}$/);
    venueId = page.url().split('/').pop()!;
    await expect(page.getByRole('heading', { name: VENUE_NAME })).toBeVisible();
  });

  await test.step('owner adds a hall and its standard prices', async () => {
    await page.getByRole('tab', { name: 'Halls & prices' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Main Hall');
    await page.getByLabel('Seating').fill('800');
    await page.getByLabel('Dining').fill('300');
    await page.getByRole('button', { name: 'Add hall' }).click();
    const hall = page.getByRole('region', { name: 'Main Hall' });
    await expect(hall).toBeVisible();
    for (const [slot, rupees] of [
      ['MORNING', '90000'],
      ['EVENING', '70000'],
      ['FULL_DAY', '140000'],
    ] as const) {
      await hall.getByLabel('Slot', { exact: true }).selectOption(slot);
      await hall.getByLabel('Price in rupees').fill(rupees);
      await hall.getByRole('button', { name: 'Set price' }).click();
      await expect(hall).toContainText(`₹${Number(rupees).toLocaleString('en-IN')}`);
    }
  });

  await test.step('owner sets the cancellation policy', async () => {
    await page.getByRole('tab', { name: 'Amenities & policies' }).click();
    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByText('Cancellation policy saved.')).toBeVisible();
  });

  await test.step('owner submits for review (photos recorded by fixture)', async () => {
    await addReadyPhotos(venueId);
    await page.reload();
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(
      page.getByText('Submitted. We review listings within two working days.'),
    ).toBeVisible();
    await expect(page.getByText('In review')).toBeVisible();
  });

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await test.step('admin verifies the owner KYC', async () => {
    await signIn(admin, process.env['E2E_ADMIN_EMAIL']!, process.env['E2E_ADMIN_PASSWORD']!);
    await admin.goto('/admin/owners');
    const row = admin.getByRole('listitem').filter({ hasText: business });
    await row.getByRole('button', { name: 'Verify' }).click();
    await expect(row.getByRole('button', { name: 'Verify' })).toHaveCount(0);
  });

  await test.step('admin approves the listing', async () => {
    await admin.goto('/admin/listings');
    await admin.getByRole('link', { name: VENUE_NAME }).click();
    await admin.getByLabel('Approve').check();
    await admin.getByRole('button', { name: 'Confirm' }).click();
    await expect(admin.getByText(/The listing is now approved/)).toBeVisible();
    await expectAccessible(admin, 'admin listing review');
  });
  await adminContext.close();

  await test.step('the venue is public and the owner is told', async () => {
    await page.goto('/search?city=kochi');
    await expect(page.getByRole('link', { name: new RegExp(VENUE_NAME) })).toBeVisible();
  });
});
