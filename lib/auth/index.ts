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
// DEMO MODE
// ============================================================================

/**
 * Whether this deployment is a public read-only demo.
 *
 * When enabled, anonymous visitors are granted a synthetic `org:member` context so
 * they can browse the app without signing up. Writes remain blocked because every
 * mutation goes through `requireAdmin()`, which rejects the member role.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

/**
 * Whether a request method is safe to serve to an anonymous demo visitor.
 *
 * Allow-list rather than deny-list: anything not explicitly read-only is refused, so a
 * method we have not considered fails closed.
 */
export function isDemoReadableMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

const DEMO_USER: AuthenticatedUser = {
  userId: 'demo',
  email: null,
  fullName: 'Demo Visitor',
  firstName: 'Demo',
  lastName: 'Visitor',
};

function createDemoAuthContext(): AuthContext {
  return {
    userId: DEMO_USER.userId,
    user: { ...DEMO_USER },
    orgId: 'demo',
    orgSlug: 'demo',
    orgRole: 'org:member',
  };
}

/**
 * Whether an auth context is the anonymous demo-mode visitor
 * (`createDemoAuthContext()`), as opposed to a genuinely authenticated user.
 *
 * Route handlers use this to decide when to redact fields — like
 * `audit.*_by`, which can carry a real admin's email via `getAuditUser()` —
 * that must never reach an anonymous caller. Keyed on `DEMO_USER.userId`
 * rather than a hardcoded `'demo'` literal so the sentinel is defined once.
 */
export function isDemoCaller(context: Pick<AuthContext, 'userId'>): boolean {
  return context.userId === DEMO_USER.userId;
}

// ============================================================================
// RBAC HELPERS
// ============================================================================

export async function getAuthContext(): Promise<AuthContext> {
  const sessionAuth = await auth();

  // Anonymous visitors on a demo deployment get read-only access. A real session
  // always takes precedence, so signed-in users keep their actual role.
  if (!sessionAuth.userId && isDemoMode()) return createDemoAuthContext();

  const authResult = await requireAuth();

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
