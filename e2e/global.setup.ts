/**
 * Global Setup for Playwright E2E Tests
 *
 * Initializes Clerk testing environment before any tests run.
 */

import { clerkSetup } from '@clerk/testing/playwright';

export default async function globalSetup() {
  await clerkSetup();
}
