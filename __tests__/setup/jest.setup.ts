/**
 * Jest Setup File
 *
 * This file runs before each test file.
 * It sets up the test environment and provides common utilities.
 */

import mongoose from 'mongoose';

// Extend Jest matchers
import '@testing-library/jest-dom';

// Set test timeout
jest.setTimeout(30000);

// ============================================================================
// Global Clerk Auth Mock
// ============================================================================
// Mock Clerk auth by default for all tests (authenticated as test user)
// Individual tests can override with jest.mock() if needed

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn().mockResolvedValue({ userId: 'user_test_default' }),
  currentUser: jest.fn().mockResolvedValue({
    id: 'user_test_default',
    fullName: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    primaryEmailAddressId: 'email_1',
    emailAddresses: [
      {
        id: 'email_1',
        emailAddress: 'test@example.com',
      },
    ],
  }),
  clerkMiddleware: jest.fn(),
  createRouteMatcher: jest.fn(() => () => false),
}));

// Connect to the test database before all tests in a file
beforeAll(async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) throw new Error('MONGODB_URI not set. Did globalSetup run?');

  // Only connect if not already connected
  if (mongoose.connection.readyState === 0)
    await mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
});

// Clear all collections after each test
afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;

    for (const key in collections) {
      const collection = collections[key];
      try {
        await collection.deleteMany({});
      } catch {
        // Collection might not exist, ignore
      }
    }
  }
});

// Disconnect from database after all tests in a file
afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    // Drop all collections to clean up
    const collections = mongoose.connection.collections;

    for (const key in collections)
      try {
        await collections[key].drop();
      } catch {
        // Collection might not exist, ignore
      }

    await mongoose.disconnect();
  }
});

// Mock console.error to track errors
const originalError = console.error;
console.error = (...args: unknown[]) => {
  // Filter out expected errors during tests
  const errorMessage = args[0]?.toString() || '';

  // Allow through, but don't fail tests for these
  if (errorMessage.includes('MongoDB') || errorMessage.includes('Connection')) return;

  originalError.apply(console, args);
};

// Global test utilities
declare global {
  var testUtils: {
    /**
     * Generate a unique test device ID
     */
    generateDeviceId: (prefix?: string) => string;

    /**
     * Wait for a specified number of milliseconds
     */
    sleep: (ms: number) => Promise<void>;

    /**
     * Create a random string of specified length
     */
    randomString: (length: number) => string;
  };
}

let deviceCounter = 0;

globalThis.testUtils = {
  generateDeviceId: (prefix = 'test_device') => {
    deviceCounter += 1;
    return `${prefix}_${Date.now()}_${deviceCounter}`;
  },

  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  randomString: (length: number) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++)
      result += chars.charAt(Math.floor(Math.random() * chars.length));

    return result;
  },
};
