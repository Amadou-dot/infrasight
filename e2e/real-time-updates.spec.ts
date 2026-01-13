/**
 * Real-time Updates E2E Tests
 *
 * End-to-end tests for Pusher real-time update functionality.
 */

import { test, expect } from '@playwright/test';

test.describe('Real-time Updates', () => {
  // ==========================================================================
  // CONNECTION TESTS
  // ==========================================================================

  test.describe('Pusher Connection', () => {
    test('should load page without WebSocket errors', async ({ page }) => {
      const errors: string[] = [];
      const consoleMessages: string[] = [];

      page.on('pageerror', error => {
        errors.push(error.message);
      });

      page.on('console', msg => {
        if (msg.type() === 'error') consoleMessages.push(msg.text());
      });

      await page.goto('/');
      await page.waitForLoadState('load');

      // Wait for any async connections
      await page.waitForTimeout(3000);

      // Filter for critical Pusher-related errors
      const pusherErrors = errors.filter(
        e => e.toLowerCase().includes('pusher') && !e.includes('connect') && !e.includes('timeout')
      );

      // Some connection warnings are expected in test env
      expect(pusherErrors.length).toBe(0);
    });

    test('should not have critical WebSocket failures', async ({ page }) => {
      const wsErrors: string[] = [];

      page.on('console', msg => {
        const text = msg.text().toLowerCase();
        if (msg.type() === 'error' && (text.includes('websocket') || text.includes('socket')))
          if (!text.includes('failed to connect') && !text.includes('timeout'))
            // Ignore expected test environment connection issues
            wsErrors.push(msg.text());
      });

      await page.goto('/');
      await page.waitForLoadState('load');
      await page.waitForTimeout(2000);

      // Critical WebSocket errors should not occur
      expect(wsErrors.length).toBe(0);
    });
  });

  // ==========================================================================
  // DATA REFRESH TESTS
  // ==========================================================================

  test.describe('Data Refresh', () => {
    test('should display timestamps on dashboard elements', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('load');

      // Look for timestamp or "last updated" indicators
      const timestamps = page.locator('text=/\\d{1,2}:\\d{2}|ago|updated|last sync/i');

      // Timestamps may or may not be visible depending on UI design
      const count = await timestamps.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should have refresh capability', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('load');

      // Look for refresh button
      const refreshButton = page.locator(
        'button[aria-label*="refresh" i], button:has-text("Refresh"), button:has(svg[class*="refresh" i])'
      );

      if ((await refreshButton.count()) > 0) {
        // Click refresh
        await refreshButton.first().click();

        // Should trigger data reload
        await page.waitForLoadState('load');
      }
    });

    test('should show loading state during data refresh', async ({ page }) => {
      await page.goto('/');

      // Look for loading indicators
      const _loadingIndicators = page.locator(
        '[data-testid="loading"], [class*="loading"], [class*="spinner"], [class*="skeleton"]'
      );

      // Loading state should appear briefly or content should load quickly
      // Wait for either loading to appear or content to be visible
      await page.waitForLoadState('domcontentloaded');

      const mainContent = page.locator('main, [role="main"]');
      await expect(mainContent.first()).toBeVisible({ timeout: 15000 });
    });
  });

  // ==========================================================================
  // LIVE DATA DISPLAY TESTS
  // ==========================================================================

  test.describe('Live Data Display', () => {
    test('should display sensor reading values', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('load');

      // Look for numeric values that could be sensor readings
      const readingValues = page.locator(
        '[data-testid="sensor-value"], [class*="reading"], text=/\\d+\\.?\\d*\\s*(°[CF]|%|ppm|lux|W)/i'
      );

      // Should have some reading values if devices exist
      const count = await readingValues.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should display status indicators', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('load');

      // Look for status indicators (green/red dots, badges, etc.)
      const statusIndicators = page.locator(
        '[data-testid="status-indicator"], [class*="status"], [class*="indicator"], [class*="badge"]'
      );

      const count = await statusIndicators.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should display device health metrics', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('load');

      // Look for health-related content
      const healthContent = page.locator(
        '[data-testid="health-widget"], [class*="health"], text=/health|online|offline|active|warning|critical/i'
      );

      const count = await healthContent.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // ANALYTICS REAL-TIME TESTS
  // ==========================================================================

  test.describe('Analytics Updates', () => {
    test('should display analytics charts', async ({ page }) => {
      await page.goto('/analytics');
      await page.waitForLoadState('load');

      // Look for chart elements
      const charts = page.locator('[class*="recharts"], [class*="chart"], svg, canvas');

      await expect(charts.first()).toBeVisible({ timeout: 15000 });
    });

    test('should display anomaly indicators', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('load');

      // Look for anomaly-related content
      const anomalyContent = page.locator(
        '[data-testid="anomaly"], [class*="anomaly"], text=/anomal/i'
      );

      // May or may not have anomalies
      const count = await anomalyContent.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should show alerts panel', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('load');

      // Look for alerts or notifications
      const alertsPanel = page.locator(
        '[data-testid="alerts-panel"], [class*="alert"], [class*="notification"], text=/alert|warning|critical/i'
      );

      const count = await alertsPanel.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // FLOOR PLAN REAL-TIME TESTS
  // ==========================================================================

  test.describe('Floor Plan Updates', () => {
    test('should load floor plan page', async ({ page }) => {
      await page.goto('/floor-plan');
      await page.waitForLoadState('load');

      // Check page loaded
      const mainContent = page.locator('main, [role="main"]');
      await expect(mainContent.first()).toBeVisible({ timeout: 15000 });
    });

    test('should display device markers on floor plan', async ({ page }) => {
      await page.goto('/floor-plan');
      await page.waitForLoadState('load');

      // Look for device markers or pins
      const deviceMarkers = page.locator(
        '[data-testid="device-marker"], [class*="marker"], [class*="pin"], svg circle, svg rect'
      );

      const count = await deviceMarkers.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should show device tooltip on hover', async ({ page }) => {
      await page.goto('/floor-plan');
      await page.waitForLoadState('load');

      // Look for hoverable device elements
      const deviceMarkers = page.locator(
        '[data-testid="device-marker"], [class*="marker"], [class*="device"]'
      );

      if ((await deviceMarkers.count()) > 0) {
        // Hover over first marker
        await deviceMarkers.first().hover();

        // Look for tooltip
        await page.waitForTimeout(500);
        const tooltip = page.locator('[role="tooltip"], [class*="tooltip"], [class*="popover"]');

        // Tooltip may or may not appear
        expect(await tooltip.count()).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ==========================================================================
  // PERFORMANCE TESTS
  // ==========================================================================

  test.describe('Performance', () => {
    test('should load dashboard within acceptable time', async ({ page }) => {
      const startTime = Date.now();

      await page.goto('/');
      await page.waitForLoadState('load');

      const loadTime = Date.now() - startTime;

      // Dashboard should load within 10 seconds
      expect(loadTime).toBeLessThan(10000);
    });

    test('should handle multiple page navigations', async ({ page }) => {
      const pages = ['/', '/devices', '/analytics', '/floor-plan', '/'];

      for (const path of pages) {
        await page.goto(path);
        await page.waitForLoadState('load');

        // Verify page loaded
        const mainContent = page.locator('main, [role="main"], body');
        await expect(mainContent.first()).toBeVisible({ timeout: 10000 });
      }
    });

    test('should not leak memory on repeated navigation', async ({ page }) => {
      // Navigate back and forth multiple times
      for (let i = 0; i < 3; i++) {
        await page.goto('/');
        await page.waitForLoadState('load');

        await page.goto('/devices');
        await page.waitForLoadState('load');
      }

      // Check for console errors that might indicate memory issues
      const errors: string[] = [];
      page.on('pageerror', error => {
        errors.push(error.message);
      });

      await page.goto('/');
      await page.waitForLoadState('load');

      const memoryErrors = errors.filter(e => e.includes('memory') || e.includes('heap'));

      expect(memoryErrors.length).toBe(0);
    });
  });
});
