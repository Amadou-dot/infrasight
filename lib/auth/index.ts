/**
 * Authentication Utilities
 *
 * Server-side authentication helpers for API routes using Clerk.
 * Provides user extraction and authentication middleware for v2 API endpoints.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { ApiError, ErrorCodes } from '@/lib/errors';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthenticatedUser {
  /** Clerk user ID */
  userId: string;
  /** User's email (primary) */
  email: string | null;
  /** User's full name */
  fullName: string | null;
  /** User's first name */
  firstName: string | null;
  /** User's last name */
  lastName: string | null;
}

export interface AuthResult {
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Authenticated user info (null if not authenticated) */
  user: AuthenticatedUser | null;
  /** Clerk user ID for quick access */
  userId: string | null;
}

// ============================================================================
// AUTHENTICATION HELPERS
// ============================================================================

/**
 * Get the current authenticated user from Clerk.
 * Returns null if not authenticated.
 *
 * @example
 * ```typescript
 * const authResult = await getAuthenticatedUser();
 * if (!authResult.isAuthenticated) {
 *   throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, 'Authentication required');
 * }
 * const userId = authResult.userId;
 * ```
 */
export async function getAuthenticatedUser(): Promise<AuthResult> {
  const { userId } = await auth();

  if (!userId) {
    return {
      isAuthenticated: false,
      user: null,
      userId: null,
    };
  }

  // Get full user details
  const user = await currentUser();

  if (!user) {
    return {
      isAuthenticated: false,
      user: null,
      userId: null,
    };
  }

  const primaryEmail = user.emailAddresses.find(
    (email) => email.id === user.primaryEmailAddressId
  );

  return {
    isAuthenticated: true,
    userId: user.id,
    user: {
      userId: user.id,
      email: primaryEmail?.emailAddress || null,
      fullName: user.fullName,
      firstName: user.firstName,
      lastName: user.lastName,
    },
  };
}

/**
 * Require authentication for an API route.
 * Throws ApiError if user is not authenticated.
 *
 * @returns The authenticated user info
 * @throws ApiError with UNAUTHORIZED code if not authenticated
 *
 * @example
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   const { userId, user } = await requireAuth();
 *   // userId is guaranteed to be non-null here
 *   const auditUser = user?.email || userId;
 * }
 * ```
 */
export async function requireAuth(): Promise<{
  userId: string;
  user: AuthenticatedUser;
}> {
  const authResult = await getAuthenticatedUser();

  if (!authResult.isAuthenticated || !authResult.userId || !authResult.user) {
    throw new ApiError(
      ErrorCodes.UNAUTHORIZED,
      401,
      'Authentication required to access this resource'
    );
  }

  return {
    userId: authResult.userId,
    user: authResult.user,
  };
}

/**
 * Get audit user string from authenticated user.
 * Returns email if available, otherwise userId.
 *
 * @example
 * ```typescript
 * const { userId, user } = await requireAuth();
 * const auditUser = getAuditUser(userId, user);
 * // auditUser = "user@example.com" or "user_xxx"
 * ```
 */
export function getAuditUser(
  userId: string,
  user: AuthenticatedUser | null
): string {
  return user?.email || userId;
}

/**
 * Higher-order function that wraps an API handler with authentication.
 * The handler receives the authenticated user info.
 *
 * @example
 * ```typescript
 * export const POST = withAuth(async (request, { userId, user }) => {
 *   const auditUser = user?.email || userId;
 *   // ... handler logic
 * });
 * ```
 */
export function withAuth<T extends unknown[]>(
  handler: (
    ...args: [...T, { userId: string; user: AuthenticatedUser }]
  ) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    const { userId, user } = await requireAuth();
    return handler(...args, { userId, user });
  };
}
