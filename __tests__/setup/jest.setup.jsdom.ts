/**
 * Jest Setup File for jsdom (Component Tests)
 *
 * This file runs before each component test file.
 * It does NOT import mongoose or set up MongoDB connections.
 */

import '@testing-library/jest-dom';

// Set test timeout
jest.setTimeout(15000);

// Mock Clerk auth for component tests
jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn().mockResolvedValue({
    userId: 'user_test_default',
    orgId: 'org_default',
    orgSlug: 'users',
    orgRole: 'org:admin',
  }),
  currentUser: jest.fn().mockResolvedValue({
    id: 'user_test_default',
    fullName: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    primaryEmailAddressId: 'email_1',
    emailAddresses: [
      { id: 'email_1', emailAddress: 'test@example.com' },
    ],
  }),
  clerkMiddleware: jest.fn(),
  createRouteMatcher: jest.fn(() => () => false),
}));

jest.mock('@clerk/nextjs', () => ({
  useUser: jest.fn(() => ({
    isSignedIn: true,
    user: { id: 'user_test_default', fullName: 'Test User' },
  })),
  useOrganization: jest.fn(() => ({
    organization: { id: 'org_default', slug: 'users' },
    membership: { role: 'org:admin' },
  })),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  UserButton: () => null,
}));
