/**
 * Playwright Configuration for Infrasight v2
 *
 * End-to-end testing configuration for critical user flows.
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

/**
 * Read environment variables or use defaults
 */
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Path to the authenticated storage state
 */
const authFile = path.join(__dirname, '.playwright/.auth/user.json');

/**
 * Playwright Configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Directory containing test files
  testDir: './e2e',

  // Test file pattern - exclude setup files from normal test runs
  testMatch: '**/*.spec.ts',

  // Global setup for Clerk authentication
  globalSetup: './e2e/global.setup.ts',

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI (for stability)
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: process.env.CI ? 'github' : [['html', { open: 'never' }]],

  // Shared settings for all projects
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL,

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on failure
    video: 'on-first-retry',

    // Maximum time each action (like click) can take
    actionTimeout: 10000,

    // Maximum time navigation can take
    navigationTimeout: 30000,
  },

  // Configure projects for major browsers
  projects: [
    // Setup project - runs authentication before other tests
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use authenticated state from setup
        storageState: authFile,
      },
      // Depend on setup project
      dependencies: ['setup'],
    },

    // Uncomment for additional browser testing
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: authFile,
    //   },
    //   dependencies: ['setup'],
    // },

    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     storageState: authFile,
    //   },
    //   dependencies: ['setup'],
    // },

    // Mobile viewports
    // {
    //   name: 'Mobile Chrome',
    //   use: {
    //     ...devices['Pixel 5'],
    //     storageState: authFile,
    //   },
    //   dependencies: ['setup'],
    // },
  ],

  // Run your local dev server before starting the tests
  // E2E_TESTING=true bypasses Clerk authentication for testing
  webServer: {
    command: 'E2E_TESTING=true pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      E2E_TESTING: 'true',
    },
  },

  // Global timeout for each test
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  // Output directory for test artifacts
  outputDir: 'test-results',
});
