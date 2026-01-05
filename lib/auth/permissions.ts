/**
 * Role-Based Access Control (RBAC) Definitions
 *
 * Defines roles and their associated permissions for API access.
 * Used by the authentication middleware to check authorization.
 */

// ============================================================================
// ROLES
// ============================================================================

export const ROLES = {
  /** Full system access - manage API keys, devices, readings, and settings */
  ADMIN: 'admin',
  /** Operational access - manage devices and readings, view analytics */
  OPERATOR: 'operator',
  /** Read-only access - view devices, readings, and analytics */
  VIEWER: 'viewer',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

/**
 * Validate if a string is a valid role
 */
export function isValidRole(role: string): role is Role {
  return Object.values(ROLES).includes(role as Role);
}

// ============================================================================
// PERMISSIONS
// ============================================================================

export const PERMISSIONS = {
  // Device permissions
  'devices:read': [ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER],
  'devices:create': [ROLES.ADMIN, ROLES.OPERATOR],
  'devices:update': [ROLES.ADMIN, ROLES.OPERATOR],
  'devices:delete': [ROLES.ADMIN],

  // Readings permissions
  'readings:read': [ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER],
  'readings:create': [ROLES.ADMIN, ROLES.OPERATOR],

  // Analytics permissions
  'analytics:read': [ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER],

  // Audit permissions
  'audit:read': [ROLES.ADMIN, ROLES.OPERATOR],

  // Admin permissions
  'admin:keys': [ROLES.ADMIN],
  'admin:settings': [ROLES.ADMIN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const allowedRoles = PERMISSIONS[permission] as readonly Role[];
  return allowedRoles?.includes(role) ?? false;
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return (Object.entries(PERMISSIONS) as [Permission, readonly Role[]][])
    .filter(([, roles]) => roles.includes(role))
    .map(([permission]) => permission);
}

// ============================================================================
// RESOURCE ACTIONS
// ============================================================================

/**
 * Map HTTP methods to permission actions
 */
export function getActionFromMethod(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'read';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'read';
  }
}

/**
 * Build permission string from resource and action
 */
export function buildPermission(resource: string, action: string): Permission {
  return `${resource}:${action}` as Permission;
}

/**
 * Get permission required for a path and method
 */
export function getRequiredPermission(path: string, method: string): Permission | null {
  const action = getActionFromMethod(method);

  // Match path to resource
  if (path.includes('/devices')) {
    return buildPermission('devices', action);
  }
  if (path.includes('/readings')) {
    return buildPermission('readings', action === 'create' ? 'create' : 'read');
  }
  if (path.includes('/analytics')) {
    return 'analytics:read';
  }
  if (path.includes('/audit')) {
    return 'audit:read';
  }
  if (path.includes('/admin')) {
    return 'admin:settings';
  }
  if (path.includes('/metadata')) {
    return 'devices:read'; // Metadata is derived from devices
  }

  return null;
}
