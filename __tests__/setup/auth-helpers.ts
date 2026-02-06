/**
 * Auth Mock Helpers for Tests
 *
 * Provides convenient helpers to override the default Clerk auth mock
 * for testing different roles and authentication states.
 *
 * Usage:
 *   import { mockAuthAsAdmin, mockAuthAsMember, mockAuthAsUnauthenticated } from '../setup/auth-helpers';
 *
 *   beforeEach(() => { mockAuthAsMember(); });
 */

import { auth, currentUser } from '@clerk/nextjs/server';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;
const mockedCurrentUser = currentUser as jest.MockedFunction<typeof currentUser>;

export function mockAuthAsAdmin() {
  mockedAuth.mockResolvedValue({
    userId: 'user_test_admin',
    orgId: 'org_default',
    orgSlug: 'users',
    orgRole: 'org:admin',
  } as ReturnType<typeof auth> extends Promise<infer T> ? T : never);

  mockedCurrentUser.mockResolvedValue({
    id: 'user_test_admin',
    fullName: 'Admin User',
    firstName: 'Admin',
    lastName: 'User',
    primaryEmailAddressId: 'email_1',
    emailAddresses: [
      { id: 'email_1', emailAddress: 'admin@example.com' },
    ],
  } as Awaited<ReturnType<typeof currentUser>>);
}

export function mockAuthAsMember() {
  mockedAuth.mockResolvedValue({
    userId: 'user_test_member',
    orgId: 'org_default',
    orgSlug: 'users',
    orgRole: 'org:member',
  } as ReturnType<typeof auth> extends Promise<infer T> ? T : never);

  mockedCurrentUser.mockResolvedValue({
    id: 'user_test_member',
    fullName: 'Member User',
    firstName: 'Member',
    lastName: 'User',
    primaryEmailAddressId: 'email_2',
    emailAddresses: [
      { id: 'email_2', emailAddress: 'member@example.com' },
    ],
  } as Awaited<ReturnType<typeof currentUser>>);
}

export function mockAuthAsUnauthenticated() {
  mockedAuth.mockResolvedValue({
    userId: null,
    orgId: null,
    orgSlug: null,
    orgRole: null,
  } as ReturnType<typeof auth> extends Promise<infer T> ? T : never);

  mockedCurrentUser.mockResolvedValue(null);
}
