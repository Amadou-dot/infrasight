/**
 * Authentication Middleware
 *
 * Provides middleware wrappers for protecting API routes.
 * Supports both required and optional authentication.
 */

import type { NextRequest } from 'next/server';
import {
  extractApiKey,
  validateApiKey,
  isAuthRequired,
  type ValidatedApiKey,
} from './apiKeys';
import {
  hasPermission,
  getRequiredPermission,
  type Permission,
  type Role,
} from './permissions';
import { ApiError } from '../errors/ApiError';
import { logger } from '../monitoring/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthContext {
  /** API key name (for audit trails) */
  keyName: string;
  /** Role for permission checks */
  role: Role;
  /** Whether user is authenticated */
  isAuthenticated: true;
}

export interface AnonymousContext {
  /** Not authenticated */
  isAuthenticated: false;
}

export type RequestContext = AuthContext | AnonymousContext;

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Require authentication middleware
 *
 * Protects an endpoint by requiring a valid API key.
 * Automatically checks permissions based on the request path and method.
 *
 * @example
 * ```typescript
 * export const POST = withAuth(async (context, request) => {
 *   console.log(`Request by: ${context.keyName}`);
 *   // Handler code
 * });
 * ```
 */
export function withAuth<T extends [NextRequest, ...unknown[]]>(
  handler: (context: AuthContext, ...args: T) => Promise<Response>,
  options?: {
    /** Override automatic permission detection */
    permission?: Permission;
  }
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    const request = args[0];

    // If auth is not required (no API keys configured), skip authentication
    if (!isAuthRequired()) {
      // Create a system context for unauthenticated requests
      const systemContext: AuthContext = {
        keyName: 'sys-unauthenticated',
        role: 'admin', // Full access when auth is disabled
        isAuthenticated: true,
      };
      return handler(systemContext, ...args);
    }

    // Extract API key
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return ApiError.unauthorized('API key required').toResponse();
    }

    // Validate API key
    const validatedKey = validateApiKey(apiKey);
    if (!validatedKey) {
      return ApiError.unauthorized('Invalid API key').toResponse();
    }

    // Determine required permission
    const permission = options?.permission ??
      getRequiredPermission(request.nextUrl.pathname, request.method);

    // Check permission
    if (permission && !hasPermission(validatedKey.role, permission)) {
      logger.auth('forbidden', validatedKey.name, {
        permission,
        role: validatedKey.role,
        path: request.nextUrl.pathname,
      });

      return ApiError.forbidden(
        `Insufficient permissions. Required: ${permission}`
      ).toResponse();
    }

    // Log successful authentication
    logger.auth('success', validatedKey.name, {
      role: validatedKey.role,
      path: request.nextUrl.pathname,
      method: request.method,
    });

    // Create auth context
    const context: AuthContext = {
      keyName: validatedKey.name,
      role: validatedKey.role,
      isAuthenticated: true,
    };

    return handler(context, ...args);
  };
}

/**
 * Optional authentication middleware
 *
 * Allows both authenticated and unauthenticated requests.
 * Useful for endpoints that provide different data based on auth status.
 *
 * @example
 * ```typescript
 * export const GET = withOptionalAuth(async (context, request) => {
 *   if (context.isAuthenticated) {
 *     // Return full data
 *   } else {
 *     // Return public data only
 *   }
 * });
 * ```
 */
export function withOptionalAuth<T extends [NextRequest, ...unknown[]]>(
  handler: (context: RequestContext, ...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    const request = args[0];

    // If auth is not required, treat as authenticated with admin role
    if (!isAuthRequired()) {
      const systemContext: AuthContext = {
        keyName: 'sys-unauthenticated',
        role: 'admin',
        isAuthenticated: true,
      };
      return handler(systemContext, ...args);
    }

    // Try to extract and validate API key
    const apiKey = extractApiKey(request);

    if (!apiKey) {
      // No key provided - anonymous context
      const context: AnonymousContext = { isAuthenticated: false };
      return handler(context, ...args);
    }

    const validatedKey = validateApiKey(apiKey);

    if (!validatedKey) {
      // Invalid key - treat as anonymous rather than error
      const context: AnonymousContext = { isAuthenticated: false };
      return handler(context, ...args);
    }

    // Valid key - authenticated context
    const context: AuthContext = {
      keyName: validatedKey.name,
      role: validatedKey.role,
      isAuthenticated: true,
    };

    return handler(context, ...args);
  };
}

/**
 * Require specific permission middleware
 *
 * More explicit than withAuth - directly specifies the required permission.
 *
 * @example
 * ```typescript
 * export const DELETE = withPermission('devices:delete', async (context, request) => {
 *   // Only admins can reach here
 * });
 * ```
 */
export function withPermission<T extends [NextRequest, ...unknown[]]>(
  permission: Permission,
  handler: (context: AuthContext, ...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return withAuth(handler, { permission });
}
