/**
 * Alerts E2E Tests
 *
 * Requires a seeded database with alert rules (`pnpm seed`) and at least one
 * successful `GET /api/v2/cron/simulate` call (bearer-authenticated with
 * SEED_SECRET) so the evaluator has actually produced alert documents.
 * Neither `pnpm seed` nor `scripts/v2/simulate.ts` triggers evaluation on its
 * own -- see `.superpowers/sdd/2026-08-01-alerting-subsystem/task-20-report.md`
 * for the exact commands used and the alert counts observed in the database
 * at the time this suite was written.
 *
 * This suite deliberately does NOT `test.skip()` past missing alert data.
 * Producing that data is this task's own responsibility, not an optional
 * precondition, so a locator that comes back empty here is a real failure to
 * surface, not something to quietly skip past.
 */

import { test, expect } from '@playwright/test';

test.describe('Alerts', () => {
  test('should render the active alerts page', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible({ timeout: 15000 });
  });

  test('should reach alerts from the top navigation, with an open-alert count badge', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // The seeded database has open (firing) alerts, so the nav badge renders
    // with an accessible name of the form "<n> open alerts" (components/TopNav.tsx).
    const badge = page.locator('[aria-label$="open alerts"]').first();
    await expect(badge).toBeVisible({ timeout: 15000 });
    await expect(badge).toHaveAttribute('aria-label', /^\d+ open alerts$/);

    await page
      .getByRole('link', { name: /alerts/i })
      .first()
      .click();

    await expect(page).toHaveURL(/\/alerts/);
    await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible({ timeout: 15000 });
  });

  test('should switch to history via the status filter, reflected in the Select', async ({
    page,
  }) => {
    await page.goto('/alerts?status=resolved');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible({ timeout: 15000 });

    // Confirms the URL param actually drove the (non-native, custom) Select's
    // displayed value, not just that the page rendered regardless of it.
    await expect(page.getByText(/resolved \(history\)/i)).toBeVisible({ timeout: 15000 });
  });

  test('should survive a refresh on a deep-linked alert', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    // The seeded database has firing alerts (see task-20-report.md), so a row
    // must be present here -- a real assertion, not a skip guard. Excludes the
    // header's "Manage rules" link, which also matches `^="/alerts/"`.
    const firstAlert = page.locator('a[href^="/alerts/"]:not([href="/alerts/rules"])').first();
    await expect(firstAlert).toBeVisible({ timeout: 15000 });

    await firstAlert.click();
    await expect(page).toHaveURL(/\/alerts\/[0-9a-f]{24}/);

    const url = page.url();
    await page.reload();
    await page.waitForLoadState('load');

    expect(page.url()).toBe(url);
    await expect(page.getByText(/breached since/i)).toBeVisible({ timeout: 15000 });
  });

  test('should render the styled 404 for an unknown alert id', async ({ page }) => {
    await page.goto('/alerts/507f1f77bcf86cd799439011');
    await page.waitForLoadState('load');

    await expect(page.getByText(/not found|404/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('should reach the rules page and show the seeded High temperature rule', async ({
    page,
  }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    await page.getByRole('link', { name: /manage rules/i }).click();

    await expect(page).toHaveURL(/\/alerts\/rules/);
    await expect(page.getByText(/high temperature/i)).toBeVisible({ timeout: 15000 });
  });

  test('should render acknowledge as a gated control -- visible, disabled, tooltipped -- rather than hiding it', async ({
    page,
  }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    // The seeded database has firing alerts, so an Acknowledge control must be
    // present here -- a real assertion, not a skip guard.
    const ack = page.getByRole('button', { name: /acknowledge/i }).first();
    await expect(ack).toBeVisible({ timeout: 15000 });

    // NEXT_PUBLIC_DEMO_MODE=true in .env.local, and this suite runs
    // unauthenticated (E2E_TESTING bypasses Clerk in proxy.ts, and
    // e2e/auth.setup.ts never actually signs in). useAdminAction() must
    // therefore take the non-admin/demo-mode branch: visible + disabled +
    // tooltip, never hidden -- see lib/auth/rbac-client.tsx.
    await expect(ack).toBeDisabled();
    await expect(ack).toHaveAttribute('title', /admin only/i);
  });
});
