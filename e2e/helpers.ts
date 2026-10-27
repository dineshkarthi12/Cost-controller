import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_PASSWORD ?? 'Toprock@2025!';
export const email = (user: string) => `${user}@toprock.example`;

export async function signIn(page: Page, user: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email(user));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
}

/** Opens a RefSelect (by its field label) and picks the first option matching `text`. */
export async function pick(page: Page, label: string, text: string, nth = 0) {
  await page.getByRole('button', { name: label }).nth(nth).click();
  const box = page.getByPlaceholder('Type to search…');
  await box.fill(text);
  await page.getByRole('option', { name: new RegExp(text) }).first().click();
}
