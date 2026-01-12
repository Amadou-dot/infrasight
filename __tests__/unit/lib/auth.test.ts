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
