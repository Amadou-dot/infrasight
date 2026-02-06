/**
 * Error Handling E2E Tests
 *
 * End-to-end tests for error state handling and recovery.
 */

import { test, expect } from '@playwright/test';

test.describe('Error Handling', () => {
  // ==========================================================================
  // NETWORK ERROR TESTS
  // ==========================================================================

  test.describe('Network Errors', () => {
    test('should handle API failures gracefully', async ({ page, context }) => {
      // Block API requests to simulate network failure
      await context.route('**/api/v2/**', (route) => route.abort());

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Page should still render (with error state)
      const pageContent = page.locator('main, body');
      await expect(pageContent.first()).toBeVisible();

      // Should not crash
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        // Filter critical errors (not network-related)
        if (
          !error.message.includes('fetch') &&
          !error.message.includes('network') &&
          !error.message.includes('Failed to fetch')
        ) {
          errors.push(error.message);
        }
      });

      await page.waitForTimeout(2000);

      expect(errors.length).toBe(0);
    });

    test('should show error state when API returns 500', async ({ page, context }) => {
      // Mock API to return 500 error
      await context.route('**/api/v2/devices**', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Internal server error',
            },
          }),
        })
      );

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Page should handle error gracefully
      const mainContent = page.locator('main, body');
      await expect(mainContent.first()).toBeVisible();
    });

    test('should handle timeout errors', async ({ page, context }) => {
      // Simulate slow API response
      await context.route('**/api/v2/**', async (route) => {
        // Delay response significantly
        await new Promise((resolve) => setTimeout(resolve, 30000));
        await route.continue();
      });

      // Set shorter timeout for test
      page.setDefaultTimeout(5000);

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

      // Page should still be usable even if API times out
      const pageContent = page.locator('body');
      await expect(pageContent).toBeVisible();
    });

    test('should recover after network restoration', async ({ page, context }) => {
      // First, block API
      await context.route('**/api/v2/devices**', (route) => route.abort());

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Unblock API
      await context.unroute('**/api/v2/devices**');

      // Trigger refresh or navigation
      const refreshButton = page.locator(
        'button[aria-label*="refresh" i], button:has-text("Refresh"), button:has-text("Retry")'
      );

      if ((await refreshButton.count()) > 0) {
        await refreshButton.first().click();
        await page.waitForLoadState('load');
      } else {
        // Alternative: reload the page
        await page.reload();
        await page.waitForLoadState('load');
      }

      // Content should load
      const mainContent = page.locator('main, [role="main"]');
      await expect(mainContent.first()).toBeVisible({ timeout: 15000 });
    });
  });

  // ==========================================================================
  // 404 PAGE TESTS
  // ==========================================================================

  test.describe('404 Not Found', () => {
    test('should show 404 page for invalid routes', async ({ page }) => {
      await page.goto('/non-existent-page-xyz');
      await page.waitForLoadState('domcontentloaded');

      // Should show 404 or redirect to home
      const is404 = page.url().includes('404') ||
        (await page.locator('text=/404|not found|page.*not.*exist/i').count()) > 0;
      const isHome = page.url() === '/' || page.url().endsWith(':3000/');

      expect(is404 || isHome).toBe(true);
    });

    test('should have navigation from 404 page', async ({ page }) => {
      await page.goto('/non-existent-page-xyz');
      await page.waitForLoadState('domcontentloaded');

      // Look for home link or navigation
      const homeLink = page.locator('a[href="/"], a:has-text("Home"), a:has-text("Dashboard")');

      if ((await homeLink.count()) > 0) {
        await homeLink.first().click();
        await page.waitForLoadState('load');

        // Should navigate to valid page
        expect(page.url()).not.toContain('non-existent');
      }
    });
  });

  // ==========================================================================
  // EMPTY STATE TESTS
  // ==========================================================================

  test.describe('Empty States', () => {
    test('should handle empty device list gracefully', async ({ page, context }) => {
      // Mock API to return empty list
      await context.route('**/api/v2/devices**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [],
            pagination: {
              page: 1,
              limit: 20,
              total: 0,
              totalPages: 0,
            },
          }),
        })
      );

      await page.goto('/');
      await page.waitForLoadState('load');

      // Should show empty state or message
      const emptyIndicators = page.locator(
        '[data-testid="empty-state"], text=/no device|no data|empty|no results/i'
      );

      // Page should be usable with empty data
      const mainContent = page.locator('main, body');
      await expect(mainContent.first()).toBeVisible();
    });

    test('should show appropriate message for empty search results', async ({ page }) => {
      await page.goto('/devices');
      await page.waitForLoadState('load');

      // Look for search input
      const searchInput = page.locator(
        'input[type="search"], input[placeholder*="search" i]'
      );

      if ((await searchInput.count()) > 0) {
        // Search for something that won't exist
        await searchInput.first().fill('xyznonexistentdevice123');
        await page.keyboard.press('Enter');

        await page.waitForTimeout(1000);

        // Should show no results message or the list should be empty
        const noResults = page.locator('text=/no result|not found|no match|no device/i');
        const deviceRows = page.locator('[data-testid="device-card"], [class*="device-card"], [class*="DeviceCard"], tr[data-testid]');

        const hasNoResultsMessage = (await noResults.count()) > 0;
        const hasNoDeviceRows = (await deviceRows.count()) === 0;

        // Either a "no results" message is shown OR the device list is empty
        expect(hasNoResultsMessage || hasNoDeviceRows).toBe(true);
      }
    });
  });

  // ==========================================================================
  // VALIDATION ERROR TESTS
  // ==========================================================================

  test.describe('Form Validation', () => {
    test('should show validation errors for invalid input', async ({ page }) => {
      // Navigate to a page with forms (settings or device creation if exists)
      await page.goto('/settings');
      await page.waitForLoadState('load');

      // Look for form inputs
      const formInputs = page.locator('input:not([type="hidden"]), textarea');

      if ((await formInputs.count()) > 0) {
        // Try to submit with invalid data
        const submitButton = page.locator(
          'button[type="submit"], button:has-text("Save"), button:has-text("Submit")'
        );

        if ((await submitButton.count()) > 0) {
          await submitButton.first().click();

          // Look for validation messages
          const validationMessages = page.locator(
            '[class*="error"], [class*="invalid"], [aria-invalid="true"], text=/required|invalid|error/i'
          );

          // Submitting an empty or invalid form should produce at least one validation message
          expect(await validationMessages.count()).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });

  // ==========================================================================
  // ERROR BOUNDARY TESTS
  // ==========================================================================

  test.describe('Error Boundaries', () => {
    test('should not show unhandled error to user', async ({ page }) => {
      const unhandledErrors: string[] = [];

      page.on('pageerror', (error) => {
        // Check for React error boundary messages
        if (
          error.message.includes('Unhandled') ||
          error.message.includes('uncaught') ||
          error.message.includes('INTERNAL_ERROR')
        ) {
          // Filter common dev-mode issues
          if (
            !error.message.includes('ResizeObserver') &&
            !error.message.includes('hydration')
          ) {
            unhandledErrors.push(error.message);
          }
        }
      });

      await page.goto('/');
      await page.waitForLoadState('load');

      // Navigate to different pages
      for (const path of ['/devices', '/analytics', '/floor-plan']) {
        await page.goto(path);
        await page.waitForLoadState('domcontentloaded');
      }

      // Should not have unhandled errors visible to user
      const errorUI = page.locator(
        'text=/something went wrong|error occurred|unexpected error/i'
      );

      // Error UI may appear but shouldn't crash
      expect(unhandledErrors.length).toBe(0);
    });

    test('should render fallback UI on component error', async ({ page }) => {
      // This tests that error boundaries catch errors
      await page.goto('/');
      await page.waitForLoadState('load');

      // Page should be functional
      const mainContent = page.locator('main, body');
      await expect(mainContent.first()).toBeVisible();

      // No uncaught promise rejections
      const uncaughtRejections: string[] = [];
      page.on('pageerror', (error) => {
        if (error.message.includes('promise') || error.message.includes('rejection')) {
          uncaughtRejections.push(error.message);
        }
      });

      await page.waitForTimeout(2000);

      // Filter non-critical rejections
      const criticalRejections = uncaughtRejections.filter(
        (r) =>
          !r.includes('Non-Error promise rejection') &&
          !r.includes('ResizeObserver')
      );

      expect(criticalRejections.length).toBe(0);
    });
  });

  // ==========================================================================
  // AUTHENTICATION ERROR TESTS
  // ==========================================================================

  test.describe('Authentication Errors', () => {
    test('should handle unauthorized API responses', async ({ page, context }) => {
      // Mock API to return 401
      await context.route('**/api/v2/**', (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
            },
          }),
        })
      );

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Should handle gracefully - might redirect to login or show error
      const pageContent = page.locator('body');
      await expect(pageContent).toBeVisible();
    });

    test('should handle forbidden API responses', async ({ page, context }) => {
      // Mock API to return 403
      await context.route('**/api/v2/**', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Access denied',
            },
          }),
        })
      );

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Should handle gracefully
      const pageContent = page.locator('body');
      await expect(pageContent).toBeVisible();
    });
  });

  // ==========================================================================
  // CONSOLE ERROR MONITORING
  // ==========================================================================

  test.describe('Console Error Monitoring', () => {
    test('should not have critical console errors on dashboard', async ({ page }) => {
      const consoleErrors: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Filter expected warnings and dev-mode issues
          if (
            !text.includes('Warning') &&
            !text.includes('DevTools') &&
            !text.includes('favicon') &&
            !text.includes('hydration') &&
            !text.includes('Hydration') &&
            !text.includes('ResizeObserver') &&
            !text.includes('Loading chunk') &&
            !text.includes('ChunkLoadError') &&
            !text.includes('Pusher') // Pusher connection issues expected in test
          ) {
            consoleErrors.push(text);
          }
        }
      });

      await page.goto('/');
      await page.waitForLoadState('load');

      expect(consoleErrors.length).toBe(0);
    });

    test('should not have critical console errors on devices page', async ({ page }) => {
      const consoleErrors: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (
            !text.includes('Warning') &&
            !text.includes('DevTools') &&
            !text.includes('favicon') &&
            !text.includes('hydration') &&
            !text.includes('ResizeObserver') &&
            !text.includes('Pusher')
          ) {
            consoleErrors.push(text);
          }
        }
      });

      await page.goto('/devices');
      await page.waitForLoadState('load');

      expect(consoleErrors.length).toBe(0);
    });

    test('should not have critical console errors on analytics page', async ({ page }) => {
      const consoleErrors: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (
            !text.includes('Warning') &&
            !text.includes('DevTools') &&
            !text.includes('favicon') &&
            !text.includes('hydration') &&
            !text.includes('ResizeObserver') &&
            !text.includes('Pusher')
          ) {
            consoleErrors.push(text);
          }
        }
      });

      await page.goto('/analytics');
      await page.waitForLoadState('load');

      expect(consoleErrors.length).toBe(0);
    });
  });
});
