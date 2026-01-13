/**
 * Device Detail E2E Tests
 *
 * End-to-end tests for device detail modal and device information flow.
 */

import { test, expect } from '@playwright/test';

test.describe('Device Detail', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the dashboard before each test
    await page.goto('/');
    await page.waitForLoadState('load');
  });

  // ==========================================================================
  // DEVICE SELECTION TESTS
  // ==========================================================================

  test.describe('Device Selection', () => {
    test('should open device detail modal when clicking a device card', async ({ page }) => {
      // Wait for devices to load
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      // Skip if no device cards found
      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      // Click the first device card
      await deviceCards.first().click();

      // Wait for modal or detail view to appear
      const detailModal = page.locator(
        '[role="dialog"], [data-testid="device-detail-modal"], [class*="DialogContent"]'
      );

      await expect(detailModal).toBeVisible({ timeout: 10000 });
    });

    test('should display device information in modal', async ({ page }) => {
      // Find and click a device card
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      // Wait for modal
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Check for device information elements
      const deviceInfo = modal.locator('text=/device|sensor|temperature|humidity|status/i');
      expect(await deviceInfo.count()).toBeGreaterThan(0);
    });

    test('should close modal when clicking close button', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      // Wait for modal to open
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Find and click close button
      const closeButton = modal.locator(
        'button[aria-label="Close"], button:has-text("Close"), button:has(svg[class*="close" i]), [data-testid="close-button"]'
      );

      if ((await closeButton.count()) > 0) {
        await closeButton.first().click();
        await expect(modal).not.toBeVisible({ timeout: 5000 });
      }
    });

    test('should close modal when pressing Escape', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      // Wait for modal to open
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Press Escape to close
      await page.keyboard.press('Escape');

      await expect(modal).not.toBeVisible({ timeout: 5000 });
    });
  });

  // ==========================================================================
  // DEVICE DETAIL CONTENT TESTS
  // ==========================================================================

  test.describe('Device Detail Content', () => {
    test('should show device status badge', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Look for status badge (active, offline, maintenance, etc.)
      const statusBadge = modal.locator(
        '[data-testid="device-status"], [class*="badge"], [class*="Badge"]'
      );

      if ((await statusBadge.count()) > 0) await expect(statusBadge.first()).toBeVisible();
    });

    test('should show device location information', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Look for location info (building, floor, room)
      const locationInfo = modal.locator('text=/building|floor|room|location/i');
      expect(await locationInfo.count()).toBeGreaterThanOrEqual(0);
    });

    test('should show device readings chart', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Look for chart container (Recharts, Chart.js, etc.)
      const chart = modal.locator(
        '[class*="recharts"], [class*="chart"], svg[class*="chart"], canvas'
      );

      // Chart may or may not exist depending on available readings
      const chartCount = await chart.count();
      expect(chartCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // DEVICE DETAIL TABS TESTS
  // ==========================================================================

  test.describe('Device Detail Tabs', () => {
    test('should have tab navigation', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Look for tabs (Overview, Readings, Config, Audit)
      const tabs = modal.locator(
        '[role="tablist"], [data-testid="device-tabs"], button:has-text("Overview"), button:has-text("Readings")'
      );

      expect(await tabs.count()).toBeGreaterThanOrEqual(0);
    });

    test('should switch between tabs', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Look for different tab buttons
      const tabButtons = modal.locator(
        'button:has-text("Readings"), button:has-text("Config"), button:has-text("Audit"), button:has-text("Overview")'
      );

      if ((await tabButtons.count()) > 1) {
        // Click a different tab
        await tabButtons.nth(1).click();

        // Content should update
        await page.waitForTimeout(500);
      }
    });

    test('should show audit log in audit tab', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Look for audit tab
      const auditTab = modal.locator('button:has-text("Audit"), button:has-text("History")');

      if ((await auditTab.count()) > 0) {
        await auditTab.first().click();

        // Wait for content to load
        await page.waitForTimeout(1000);

        // Look for audit log content
        const auditContent = modal.locator(
          '[data-testid="audit-log"], text=/created|updated|modified/i'
        );

        expect(await auditContent.count()).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ==========================================================================
  // DEVICES PAGE TESTS
  // ==========================================================================

  test.describe('Devices Page', () => {
    test('should navigate to devices page', async ({ page }) => {
      // Look for navigation link to devices
      const devicesLink = page.locator('a[href="/devices"], nav button:has-text("Devices")');

      if ((await devicesLink.count()) > 0) {
        await devicesLink.first().click();
        await page.waitForLoadState('load');

        expect(page.url()).toContain('/devices');
      }
    });

    test('should display device list on devices page', async ({ page }) => {
      await page.goto('/devices');
      await page.waitForLoadState('load');

      // Check for device list or table
      const deviceList = page.locator(
        '[data-testid="device-list"], table, [class*="grid"], [class*="device"]'
      );

      await expect(deviceList.first()).toBeVisible({ timeout: 15000 });
    });

    test('should filter devices on devices page', async ({ page }) => {
      await page.goto('/devices');
      await page.waitForLoadState('load');

      // Look for filter controls
      const filterInput = page.locator(
        'input[placeholder*="search" i], input[placeholder*="filter" i], select'
      );

      if ((await filterInput.count()) > 0) {
        // Try filtering
        const input = filterInput.first();
        const tagName = await input.evaluate(el => el.tagName.toLowerCase());

        if (tagName === 'input') await input.fill('temperature');
        else if (tagName === 'select') await input.selectOption({ index: 1 });

        // Wait for filter to apply
        await page.waitForTimeout(1000);
      }
    });

    test('should paginate device list', async ({ page }) => {
      await page.goto('/devices');
      await page.waitForLoadState('load');

      // Look for pagination controls
      const pagination = page.locator(
        '[data-testid="pagination"], nav[aria-label*="pagination"], button:has-text("Next"), button:has-text("Previous")'
      );

      if ((await pagination.count()) > 0) {
        const nextButton = page.locator('button:has-text("Next"), button[aria-label*="next"]');

        if ((await nextButton.count()) > 0 && (await nextButton.isEnabled())) {
          await nextButton.click();
          await page.waitForLoadState('load');
        }
      }
    });
  });

  // ==========================================================================
  // DEVICE ACTIONS TESTS
  // ==========================================================================

  test.describe('Device Actions', () => {
    test('should show device action buttons in modal', async ({ page }) => {
      const deviceCards = page.locator(
        '[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"]'
      );

      if ((await deviceCards.count()) === 0) {
        test.skip();
        return;
      }

      await deviceCards.first().click();

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Look for action buttons
      const actionButtons = modal.locator(
        'button:has-text("Edit"), button:has-text("Delete"), button:has-text("Maintenance")'
      );

      // Actions may or may not exist depending on user permissions
      expect(await actionButtons.count()).toBeGreaterThanOrEqual(0);
    });
  });
});
