/**
 * Authentication Utilities
 *
 * Server-side authentication helpers for API routes using Clerk.
 * Provides user extraction and authentication middleware for v2 API endpoints.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { ApiError, ErrorCodes } from '@/lib/errors';

// ============================================================================
// RBAC TYPES & CONSTANTS
// ============================================================================

export type OrgRole = 'org:admin' | 'org:member';

export interface AuthContext {
  userId: string;
  user: AuthenticatedUser;
  orgId: string;
  orgSlug: string;
  orgRole: OrgRole;
}

const DEFAULT_ALLOWED_ORG_SLUGS = ['users'];

function getAllowedOrgSlugs(): string[] {
  const raw = process.env.CLERK_ALLOWED_ORG_SLUGS;
  if (!raw) return DEFAULT_ALLOWED_ORG_SLUGS;
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.toLowerCase());
}

function assertAllowedOrg(orgSlug: string | null): asserts orgSlug is string {
  if (!orgSlug)
    throw ApiError.forbidden('Organization membership required to access this resource');

  const allowedOrgs = getAllowedOrgSlugs();
  if (allowedOrgs.length > 0 && !allowedOrgs.includes(orgSlug.toLowerCase()))
    throw ApiError.forbidden('You are not a member of the required organization');
}

function assertOrgRole(orgRole: string | null): asserts orgRole is OrgRole {
  if (!orgRole) throw ApiError.forbidden('Organization role required to access this resource');

  if (orgRole !== 'org:admin' && orgRole !== 'org:member')
    throw ApiError.forbidden(`Unsupported organization role: ${orgRole}`);
}

// ============================================================================
// RBAC HELPERS
// ============================================================================

export async function getAuthContext(): Promise<AuthContext> {
  const authResult = await requireAuth();
  const sessionAuth = await auth();

  assertAllowedOrg(sessionAuth.orgSlug ?? null);
  assertOrgRole(sessionAuth.orgRole ?? null);

  return {
    userId: authResult.userId,
    user: authResult.user,
    orgId: sessionAuth.orgId as string,
    orgSlug: sessionAuth.orgSlug as string,
    orgRole: sessionAuth.orgRole as OrgRole,
  };
}

export async function requireOrgMembership(): Promise<AuthContext> {
  return getAuthContext();
}

export async function requireAdmin(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (context.orgRole !== 'org:admin')
    throw ApiError.forbidden('Admin role required to perform this action');

  return context;
}

export function isAdminRole(role: OrgRole): boolean {
  return role === 'org:admin';
}

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

  if (!userId)
    return {
      isAuthenticated: false,
      user: null,
      userId: null,
    };

  // Get full user details
  const user = await currentUser();

  if (!user)
    return {
      isAuthenticated: false,
      user: null,
      userId: null,
    };

  const primaryEmail = user.emailAddresses.find(email => email.id === user.primaryEmailAddressId);

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

  if (!authResult.isAuthenticated || !authResult.userId || !authResult.user)
    throw new ApiError(
      ErrorCodes.UNAUTHORIZED,
      401,
      'Authentication required to access this resource'
    );

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
export function getAuditUser(userId: string, user: AuthenticatedUser | null): string {
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
  handler: (...args: [...T, { userId: string; user: AuthenticatedUser }]) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    const { userId, user } = await requireAuth();
    return handler(...args, { userId, user });
  };
}
