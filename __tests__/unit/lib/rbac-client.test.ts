/**
 * RBAC Client Hook Tests
 *
 * Tests for useRbac hook behavior with Clerk auth state.
 */

import { useRbac } from '@/lib/auth/rbac-client';

jest.mock('@clerk/nextjs', () => ({
  useAuth: jest.fn(),
}));

describe('useRbac', () => {
  const { useAuth } = require('@clerk/nextjs');
  let originalEnv: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = process.env.NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS;
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS;
    else process.env.NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS = originalEnv;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS;
    else process.env.NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS = originalEnv;
  });

  it('should return admin state when signed in with admin role', () => {
    useAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      orgRole: 'org:admin',
      orgSlug: 'users',
    });

    const state = useRbac();

    expect(state.isAdmin).toBe(true);
    expect(state.isMember).toBe(false);
    expect(state.orgSlug).toBe('users');
  });

  it('should return member state when signed in with member role', () => {
    useAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      orgRole: 'org:member',
      orgSlug: 'users',
    });

    const state = useRbac();

    expect(state.isAdmin).toBe(false);
    expect(state.isMember).toBe(true);
  });

  it('should clear org data when org is not allowed', () => {
    process.env.NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS = 'admins';
    useAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      orgRole: 'org:admin',
      orgSlug: 'users',
    });

    const state = useRbac();

    expect(state.isAdmin).toBe(false);
    expect(state.isMember).toBe(false);
    expect(state.orgSlug).toBeNull();
  });

  it('should return false for roles when not signed in', () => {
    useAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: false,
      orgRole: null,
      orgSlug: null,
    });

    const state = useRbac();

    expect(state.isAdmin).toBe(false);
    expect(state.isMember).toBe(false);
    expect(state.isSignedIn).toBe(false);
  });
});
