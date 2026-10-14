import { test, expect } from '@playwright/test';
import { CREDS } from './helpers.js';

/** Auth screens, driven without a stored session. */
test.use({ storageState: { cookies: [], origins: [] } });

test('wrong password shows an error; the right one signs in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth-form')).toBeVisible();

  await page.fill('#auth-username', CREDS.username);
  await page.fill('#auth-password', 'wrong-password');
  await page.click('#auth-submit');
  await expect(page.locator('#auth-error')).toBeVisible();
  await expect(page.locator('#auth-error')).toHaveText(/Wrong username or password/i);

  await page.fill('#auth-password', CREDS.password);
  await page.click('#auth-submit');
  await expect(page.locator('#user-name')).toHaveText(CREDS.name);
  await expect(page.locator('h1')).toHaveText('Dashboard');
});

test('signup tab asks for a name; login tab does not', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth-name-field')).toBeHidden();
  await page.click('.auth-tabs button[data-mode="signup"]');
  await expect(page.locator('#auth-name-field')).toBeVisible();
});
