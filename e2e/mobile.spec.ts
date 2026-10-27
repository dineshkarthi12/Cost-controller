import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('mobile layout: bottom navigation, camera capture entry, no horizontal scrolling', async ({ page }) => {
  await signIn(page, 'karthik.s');
  const nav = page.getByRole('navigation', { name: 'Quick navigation' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible();
  await nav.getByRole('link', { name: 'Capture site photo' }).click();
  await expect(page).toHaveURL(/\/evidence\?capture=1/);
  for (const path of ['/', '/evidence', '/procurement/mr', '/manpower']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});
