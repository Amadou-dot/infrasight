/**
 * Auth Module Tests
 *
 * Tests for authentication utilities.
 */

import { ApiError } from '@/lib/errors/ApiError';

// Mock Clerk auth functions
jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
}));

describe('Auth Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  // ==========================================================================
  // getAuthenticatedUser()
  // ==========================================================================

  describe('getAuthenticatedUser()', () => {
    it('should return unauthenticated result when no userId', async () => {
      const { auth } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({ userId: null });

      const { getAuthenticatedUser } = require('@/lib/auth');
      const result = await getAuthenticatedUser();

      expect(result.isAuthenticated).toBe(false);
      expect(result.user).toBeNull();
      expect(result.userId).toBeNull();
    });

    it('should return unauthenticated result when currentUser returns null', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({ userId: 'user_123' });
      currentUser.mockResolvedValue(null);

      const { getAuthenticatedUser } = require('@/lib/auth');
      const result = await getAuthenticatedUser();

      expect(result.isAuthenticated).toBe(false);
      expect(result.user).toBeNull();
      expect(result.userId).toBeNull();
    });

    it('should return authenticated user with email', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({ userId: 'user_123' });
      currentUser.mockResolvedValue({
        id: 'user_123',
        fullName: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        primaryEmailAddressId: 'email_1',
        emailAddresses: [
          { id: 'email_1', emailAddress: 'john@example.com' },
        ],
      });

      const { getAuthenticatedUser } = require('@/lib/auth');
      const result = await getAuthenticatedUser();

      expect(result.isAuthenticated).toBe(true);
      expect(result.userId).toBe('user_123');
      expect(result.user).toEqual({
        userId: 'user_123',
        email: 'john@example.com',
        fullName: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should handle user without primary email', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({ userId: 'user_123' });
      currentUser.mockResolvedValue({
        id: 'user_123',
        fullName: null,
        firstName: null,
        lastName: null,
        primaryEmailAddressId: 'email_missing',
        emailAddresses: [
          { id: 'email_1', emailAddress: 'other@example.com' },
        ],
      });

      const { getAuthenticatedUser } = require('@/lib/auth');
      const result = await getAuthenticatedUser();

      expect(result.isAuthenticated).toBe(true);
      expect(result.user?.email).toBeNull();
    });
  });

  // ==========================================================================
  // requireAuth()
  // ==========================================================================

  describe('requireAuth()', () => {
    it('should throw ApiError when not authenticated', async () => {
      const { auth } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({ userId: null });

      const { requireAuth } = require('@/lib/auth');

      await expect(requireAuth()).rejects.toThrow('Authentication required');

      try {
        await requireAuth();
      } catch (error) {
        expect((error as ApiError).errorCode).toBe('UNAUTHORIZED');
        expect((error as ApiError).statusCode).toBe(401);
      }
    });

    it('should return userId and user when authenticated', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({ userId: 'user_123' });
      currentUser.mockResolvedValue({
        id: 'user_123',
        fullName: 'Jane Doe',
        firstName: 'Jane',
        lastName: 'Doe',
        primaryEmailAddressId: 'email_1',
        emailAddresses: [
          { id: 'email_1', emailAddress: 'jane@example.com' },
        ],
      });

      const { requireAuth } = require('@/lib/auth');
      const result = await requireAuth();

      expect(result.userId).toBe('user_123');
      expect(result.user.email).toBe('jane@example.com');
    });
  });

  // ==========================================================================
  // getAuditUser()
  // ==========================================================================

  describe('getAuditUser()', () => {
    it('should return email when available', () => {
      const { getAuditUser } = require('@/lib/auth');

      const result = getAuditUser('user_123', {
        userId: 'user_123',
        email: 'test@example.com',
        fullName: 'Test User',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(result).toBe('test@example.com');
    });

    it('should return userId when email is null', () => {
      const { getAuditUser } = require('@/lib/auth');

      const result = getAuditUser('user_123', {
        userId: 'user_123',
        email: null,
        fullName: null,
        firstName: null,
        lastName: null,
      });

      expect(result).toBe('user_123');
    });

    it('should return userId when user is null', () => {
      const { getAuditUser } = require('@/lib/auth');

      const result = getAuditUser('user_123', null);

      expect(result).toBe('user_123');
    });
  });

  // ==========================================================================
  // getAuthContext() / requireOrgMembership() / requireAdmin()
  // ==========================================================================

  describe('RBAC helpers', () => {
    it('should return auth context for admin in allowed org', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({
        userId: 'user_admin',
        orgId: 'org_123',
        orgSlug: 'users',
        orgRole: 'org:admin',
      } as Awaited<ReturnType<typeof auth>>);
      currentUser.mockResolvedValue({
        id: 'user_admin',
        fullName: 'Admin User',
        firstName: 'Admin',
        lastName: 'User',
        primaryEmailAddressId: 'email_admin',
        emailAddresses: [
          { id: 'email_admin', emailAddress: 'admin@example.com' },
        ],
      });

      const { getAuthContext } = require('@/lib/auth');
      const context = await getAuthContext();

      expect(context.userId).toBe('user_admin');
      expect(context.orgId).toBe('org_123');
      expect(context.orgSlug).toBe('users');
      expect(context.orgRole).toBe('org:admin');
    });

    it('should reject when org slug is missing', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({
        userId: 'user_no_org',
        orgId: null,
        orgSlug: null,
        orgRole: 'org:admin',
      } as Awaited<ReturnType<typeof auth>>);
      currentUser.mockResolvedValue({
        id: 'user_no_org',
        fullName: 'No Org',
        firstName: 'No',
        lastName: 'Org',
        primaryEmailAddressId: 'email_no_org',
        emailAddresses: [
          { id: 'email_no_org', emailAddress: 'noorg@example.com' },
        ],
      });

      const { getAuthContext } = require('@/lib/auth');
      await expect(getAuthContext()).rejects.toThrow('Organization membership required');
    });

    it('should reject when org slug not allowed', async () => {
      process.env.CLERK_ALLOWED_ORG_SLUGS = 'admins';

      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({
        userId: 'user_bad_org',
        orgId: 'org_bad',
        orgSlug: 'users',
        orgRole: 'org:admin',
      } as Awaited<ReturnType<typeof auth>>);
      currentUser.mockResolvedValue({
        id: 'user_bad_org',
        fullName: 'Bad Org',
        firstName: 'Bad',
        lastName: 'Org',
        primaryEmailAddressId: 'email_bad_org',
        emailAddresses: [
          { id: 'email_bad_org', emailAddress: 'badorg@example.com' },
        ],
      });

      const { requireOrgMembership } = require('@/lib/auth');
      await expect(requireOrgMembership()).rejects.toThrow('required organization');

      delete process.env.CLERK_ALLOWED_ORG_SLUGS;
    });

    it('should reject unsupported org role', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({
        userId: 'user_role',
        orgId: 'org_role',
        orgSlug: 'users',
        orgRole: 'org:viewer',
      } as Awaited<ReturnType<typeof auth>>);
      currentUser.mockResolvedValue({
        id: 'user_role',
        fullName: 'Viewer Role',
        firstName: 'Viewer',
        lastName: 'Role',
        primaryEmailAddressId: 'email_role',
        emailAddresses: [
          { id: 'email_role', emailAddress: 'viewer@example.com' },
        ],
      });

      const { getAuthContext } = require('@/lib/auth');
      await expect(getAuthContext()).rejects.toThrow('Unsupported organization role');
    });

    it('should reject admin requirement for member role', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({
        userId: 'user_member',
        orgId: 'org_member',
        orgSlug: 'users',
        orgRole: 'org:member',
      } as Awaited<ReturnType<typeof auth>>);
      currentUser.mockResolvedValue({
        id: 'user_member',
        fullName: 'Member User',
        firstName: 'Member',
        lastName: 'User',
        primaryEmailAddressId: 'email_member',
        emailAddresses: [
          { id: 'email_member', emailAddress: 'member@example.com' },
        ],
      });

      const { requireAdmin } = require('@/lib/auth');
      await expect(requireAdmin()).rejects.toThrow('Admin role required');
    });
  });

  // ==========================================================================
  // isAdminRole()
  // ==========================================================================

  describe('isAdminRole()', () => {
    it('should return true for org:admin role', () => {
      const { isAdminRole } = require('@/lib/auth');

      expect(isAdminRole('org:admin')).toBe(true);
    });

    it('should return false for org:member role', () => {
      const { isAdminRole } = require('@/lib/auth');

      expect(isAdminRole('org:member')).toBe(false);
    });
  });

  // ==========================================================================
  // withAuth()
  // ==========================================================================

  describe('withAuth()', () => {
    it('should call handler with auth info when authenticated', async () => {
      const { auth, currentUser } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({ userId: 'user_123' });
      currentUser.mockResolvedValue({
        id: 'user_123',
        fullName: 'Test User',
        firstName: 'Test',
        lastName: 'User',
        primaryEmailAddressId: 'email_1',
        emailAddresses: [
          { id: 'email_1', emailAddress: 'test@example.com' },
        ],
      });

      const { withAuth } = require('@/lib/auth');

      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withAuth(handler);

      const mockRequest = { method: 'POST' };
      await wrappedHandler(mockRequest);

      expect(handler).toHaveBeenCalledWith(
        mockRequest,
        expect.objectContaining({
          userId: 'user_123',
          user: expect.objectContaining({
            email: 'test@example.com',
          }),
        })
      );
    });

    it('should throw when not authenticated', async () => {
      const { auth } = require('@clerk/nextjs/server');
      auth.mockResolvedValue({ userId: null });

      const { withAuth } = require('@/lib/auth');

      const handler = jest.fn().mockResolvedValue(new Response('OK'));
      const wrappedHandler = withAuth(handler);

      await expect(wrappedHandler({})).rejects.toThrow('Authentication required');
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
