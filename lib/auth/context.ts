/**
 * User Context for Audit Trails
 *
 * Provides user identification for audit trail fields.
 * Used by device and reading mutations to track who made changes.
 */

import type { AuthContext, RequestContext } from './middleware';

/**
 * Get user identifier for audit trails
 *
 * Returns the API key name if authenticated, otherwise returns
 * the system identifier for unauthenticated operations.
 */
export function getAuditUser(context: RequestContext | null): string {
  if (context && context.isAuthenticated) 
    return context.keyName;
  
  return 'sys-migration-agent';
}

/**
 * Get user identifier from AuthContext (guaranteed authenticated)
 */
export function getAuthenticatedUser(context: AuthContext): string {
  return context.keyName;
}

/**
 * Check if context represents an authenticated user
 */
export function isAuthenticated(
  context: RequestContext | null
): context is AuthContext {
  return context !== null && context.isAuthenticated;
}

/**
 * Create audit metadata for database operations
 */
export function createAuditMetadata(
  context: RequestContext | null,
  action: 'create' | 'update' | 'delete'
): Record<string, unknown> {
  const user = getAuditUser(context);
  const timestamp = new Date();

  switch (action) {
    case 'create':
      return {
        'audit.created_by': user,
        'audit.created_at': timestamp,
        'audit.updated_by': user,
        'audit.updated_at': timestamp,
      };
    case 'update':
      return {
        'audit.updated_by': user,
        'audit.updated_at': timestamp,
      };
    case 'delete':
      return {
        'audit.deleted_by': user,
        'audit.deleted_at': timestamp,
        'audit.updated_by': user,
        'audit.updated_at': timestamp,
      };
  }
}
