/**
 * Playwright Authentication Setup
 *
 * When E2E_TESTING=true is set (via playwright.config.ts webServer),
 * Clerk authentication is bypassed in the middleware.
 *
 * This setup file simply initializes the storage state for consistency.
 */

import { test as setup } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../.playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
  // Navigate to the app - auth is bypassed via E2E_TESTING env var
  await page.goto('/');

  // Wait for page to load
  await page.waitForLoadState('domcontentloaded');

  // Save storage state
  await page.context().storageState({ path: authFile });
});
