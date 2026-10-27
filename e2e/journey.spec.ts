import { expect, test } from '@playwright/test';
import { email, PASSWORD, pick, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

let mrNumber = '';

test('site engineer raises a material requisition and submits it for approval', async ({ page }) => {
  await signIn(page, 'karthik.s');
  await page.goto('/procurement/mr/new');
  await expect(page.getByRole('heading', { name: 'New material requisition' })).toBeVisible();
  await page.getByLabel('Department / requester area').fill('Tower A — level 9 slab');
  await page.getByLabel('Required by').fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  await pick(page, 'Budget / cost code', '03-200');
  await pick(page, 'Material', 'CEM-OPC53');
  await page.getByLabel('Qty').fill('250');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/RH-MR-\d{4}/);
  mrNumber = ((await page.getByRole('heading', { level: 1 }).textContent()) ?? '').match(/RH-MR-\d{4}/)![0];
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Submitted');
});

test('the submitter cannot approve; the project manager approves from the inbox', async ({ page }) => {
  await signIn(page, 'karthik.s');
  await page.goto('/approvals');
  await expect(page.getByText(mrNumber)).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, 'rajesh.iyer');
  await page.goto('/approvals');
  const row = page.getByRole('row').filter({ hasText: mrNumber });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('row').filter({ hasText: mrNumber })).toHaveCount(0);

  await page.goto('/procurement/mr');
  await page.getByLabel('Current project').selectOption({ label: 'RH · Riverside Heights' });
  await expect(page.getByRole('row').filter({ hasText: mrNumber })).toContainText('Approved');
});

test('cost control lead sees live cost KPIs and can export a report', async ({ page }) => {
  await signIn(page, 'dinesh.kumar');
  await expect(page.getByText('Approved budget').first()).toBeVisible();
  await expect(page.getByText('DEMO DATA')).toBeVisible();
  await page.goto('/reports?r=project-cost-summary');
  await expect(page.getByRole('table')).toContainText('TOTAL');
  for (const [label, ext] of [['CSV', 'csv'], ['PDF', 'pdf'], ['Excel (.xlsx)', 'xlsx']] as const) {
    await page.getByRole('button', { name: 'Export' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: label }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^[A-Z0-9]+-project-cost-summary-.*\\.${ext}$`));
    const path = await download.path();
    const { size } = await import('node:fs').then((fs) => fs.statSync(path));
    expect(size).toBeGreaterThan(200);
  }
});

test('permissions are enforced in the UI and by the API', async ({ page, request }) => {
  await signIn(page, 'karthik.s');
  await page.goto('/admin/users');
  await expect(page.getByText(/permission/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0);
  const login = await request.post('/api/auth/login', { headers: { 'X-Requested-With': 'toprock' }, data: { email: email('karthik.s'), password: PASSWORD } });
  expect(login.status()).toBe(200);
  expect((await request.get('/api/admin/users', { headers: { 'X-Requested-With': 'toprock' } })).status()).toBe(403);
});
