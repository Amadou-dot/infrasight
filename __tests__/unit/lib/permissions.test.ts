/**
 * Permissions (RBAC) Tests
 *
 * Tests for role-based access control definitions and utilities.
 */

import {
  ROLES,
  PERMISSIONS,
  type Role,
  type Permission,
  isValidRole,
  hasPermission,
  getPermissionsForRole,
  getActionFromMethod,
  buildPermission,
  getRequiredPermission,
} from '@/lib/auth/permissions';

describe('Permissions (RBAC)', () => {
  // ==========================================================================
  // ROLE CONSTANTS
  // ==========================================================================

  describe('ROLES', () => {
    it('should define admin role', () => {
      expect(ROLES.ADMIN).toBe('admin');
    });

    it('should define operator role', () => {
      expect(ROLES.OPERATOR).toBe('operator');
    });

    it('should define viewer role', () => {
      expect(ROLES.VIEWER).toBe('viewer');
    });

    it('should have exactly 3 roles', () => {
      expect(Object.keys(ROLES)).toHaveLength(3);
    });
  });

  // ==========================================================================
  // PERMISSION CONSTANTS
  // ==========================================================================

  describe('PERMISSIONS', () => {
    it('should define device permissions', () => {
      expect(PERMISSIONS['devices:read']).toBeDefined();
      expect(PERMISSIONS['devices:create']).toBeDefined();
      expect(PERMISSIONS['devices:update']).toBeDefined();
      expect(PERMISSIONS['devices:delete']).toBeDefined();
    });

    it('should define readings permissions', () => {
      expect(PERMISSIONS['readings:read']).toBeDefined();
      expect(PERMISSIONS['readings:create']).toBeDefined();
    });

    it('should define analytics permissions', () => {
      expect(PERMISSIONS['analytics:read']).toBeDefined();
    });

    it('should define audit permissions', () => {
      expect(PERMISSIONS['audit:read']).toBeDefined();
    });

    it('should define admin permissions', () => {
      expect(PERMISSIONS['admin:keys']).toBeDefined();
      expect(PERMISSIONS['admin:settings']).toBeDefined();
    });

    it('should grant all roles read access to devices', () => {
      expect(PERMISSIONS['devices:read']).toContain(ROLES.ADMIN);
      expect(PERMISSIONS['devices:read']).toContain(ROLES.OPERATOR);
      expect(PERMISSIONS['devices:read']).toContain(ROLES.VIEWER);
    });

    it('should restrict device deletion to admin only', () => {
      expect(PERMISSIONS['devices:delete']).toContain(ROLES.ADMIN);
      expect(PERMISSIONS['devices:delete']).not.toContain(ROLES.OPERATOR);
      expect(PERMISSIONS['devices:delete']).not.toContain(ROLES.VIEWER);
    });

    it('should restrict admin permissions to admin role', () => {
      expect(PERMISSIONS['admin:keys']).toEqual([ROLES.ADMIN]);
      expect(PERMISSIONS['admin:settings']).toEqual([ROLES.ADMIN]);
    });
  });

  // ==========================================================================
  // isValidRole()
  // ==========================================================================

  describe('isValidRole()', () => {
    it('should return true for valid roles', () => {
      expect(isValidRole('admin')).toBe(true);
      expect(isValidRole('operator')).toBe(true);
      expect(isValidRole('viewer')).toBe(true);
    });

    it('should return false for invalid roles', () => {
      expect(isValidRole('superadmin')).toBe(false);
      expect(isValidRole('guest')).toBe(false);
      expect(isValidRole('')).toBe(false);
      expect(isValidRole('ADMIN')).toBe(false); // Case-sensitive
    });
  });

  // ==========================================================================
  // hasPermission()
  // ==========================================================================

  describe('hasPermission()', () => {
    describe('Admin role', () => {
      it('should have all permissions', () => {
        const allPermissions = Object.keys(PERMISSIONS) as Permission[];
        for (const permission of allPermissions) {
          expect(hasPermission('admin', permission)).toBe(true);
        }
      });
    });

    describe('Operator role', () => {
      it('should have device read/create/update permissions', () => {
        expect(hasPermission('operator', 'devices:read')).toBe(true);
        expect(hasPermission('operator', 'devices:create')).toBe(true);
        expect(hasPermission('operator', 'devices:update')).toBe(true);
      });

      it('should not have device delete permission', () => {
        expect(hasPermission('operator', 'devices:delete')).toBe(false);
      });

      it('should have readings permissions', () => {
        expect(hasPermission('operator', 'readings:read')).toBe(true);
        expect(hasPermission('operator', 'readings:create')).toBe(true);
      });

      it('should have analytics read permission', () => {
        expect(hasPermission('operator', 'analytics:read')).toBe(true);
      });

      it('should have audit read permission', () => {
        expect(hasPermission('operator', 'audit:read')).toBe(true);
      });

      it('should not have admin permissions', () => {
        expect(hasPermission('operator', 'admin:keys')).toBe(false);
        expect(hasPermission('operator', 'admin:settings')).toBe(false);
      });
    });

    describe('Viewer role', () => {
      it('should have read permissions', () => {
        expect(hasPermission('viewer', 'devices:read')).toBe(true);
        expect(hasPermission('viewer', 'readings:read')).toBe(true);
        expect(hasPermission('viewer', 'analytics:read')).toBe(true);
      });

      it('should not have create/update/delete permissions', () => {
        expect(hasPermission('viewer', 'devices:create')).toBe(false);
        expect(hasPermission('viewer', 'devices:update')).toBe(false);
        expect(hasPermission('viewer', 'devices:delete')).toBe(false);
        expect(hasPermission('viewer', 'readings:create')).toBe(false);
      });

      it('should not have audit read permission', () => {
        expect(hasPermission('viewer', 'audit:read')).toBe(false);
      });

      it('should not have admin permissions', () => {
        expect(hasPermission('viewer', 'admin:keys')).toBe(false);
        expect(hasPermission('viewer', 'admin:settings')).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should return false for non-existent permission', () => {
        // TypeScript would catch this, but testing runtime behavior
        expect(hasPermission('admin', 'nonexistent:permission' as Permission)).toBe(false);
      });
    });
  });

  // ==========================================================================
  // getPermissionsForRole()
  // ==========================================================================

  describe('getPermissionsForRole()', () => {
    it('should return all permissions for admin', () => {
      const adminPerms = getPermissionsForRole('admin');
      const allPermissions = Object.keys(PERMISSIONS) as Permission[];
      expect(adminPerms.sort()).toEqual(allPermissions.sort());
    });

    it('should return correct permissions for operator', () => {
      const operatorPerms = getPermissionsForRole('operator');
      expect(operatorPerms).toContain('devices:read');
      expect(operatorPerms).toContain('devices:create');
      expect(operatorPerms).toContain('devices:update');
      expect(operatorPerms).not.toContain('devices:delete');
      expect(operatorPerms).not.toContain('admin:keys');
    });

    it('should return correct permissions for viewer', () => {
      const viewerPerms = getPermissionsForRole('viewer');
      expect(viewerPerms).toContain('devices:read');
      expect(viewerPerms).toContain('readings:read');
      expect(viewerPerms).toContain('analytics:read');
      expect(viewerPerms).not.toContain('devices:create');
      expect(viewerPerms).not.toContain('audit:read');
    });

    it('should return fewer permissions for viewer than operator', () => {
      const viewerPerms = getPermissionsForRole('viewer');
      const operatorPerms = getPermissionsForRole('operator');
      expect(viewerPerms.length).toBeLessThan(operatorPerms.length);
    });

    it('should return fewer permissions for operator than admin', () => {
      const operatorPerms = getPermissionsForRole('operator');
      const adminPerms = getPermissionsForRole('admin');
      expect(operatorPerms.length).toBeLessThan(adminPerms.length);
    });
  });

  // ==========================================================================
  // getActionFromMethod()
  // ==========================================================================

  describe('getActionFromMethod()', () => {
    it('should map GET to read', () => {
      expect(getActionFromMethod('GET')).toBe('read');
      expect(getActionFromMethod('get')).toBe('read');
    });

    it('should map POST to create', () => {
      expect(getActionFromMethod('POST')).toBe('create');
      expect(getActionFromMethod('post')).toBe('create');
    });

    it('should map PUT to update', () => {
      expect(getActionFromMethod('PUT')).toBe('update');
      expect(getActionFromMethod('put')).toBe('update');
    });

    it('should map PATCH to update', () => {
      expect(getActionFromMethod('PATCH')).toBe('update');
      expect(getActionFromMethod('patch')).toBe('update');
    });

    it('should map DELETE to delete', () => {
      expect(getActionFromMethod('DELETE')).toBe('delete');
      expect(getActionFromMethod('delete')).toBe('delete');
    });

    it('should default to read for unknown methods', () => {
      expect(getActionFromMethod('OPTIONS')).toBe('read');
      expect(getActionFromMethod('HEAD')).toBe('read');
      expect(getActionFromMethod('CUSTOM')).toBe('read');
    });
  });

  // ==========================================================================
  // buildPermission()
  // ==========================================================================

  describe('buildPermission()', () => {
    it('should build permission string from resource and action', () => {
      expect(buildPermission('devices', 'read')).toBe('devices:read');
      expect(buildPermission('readings', 'create')).toBe('readings:create');
      expect(buildPermission('admin', 'settings')).toBe('admin:settings');
    });

    it('should handle arbitrary resource/action combinations', () => {
      expect(buildPermission('custom', 'action')).toBe('custom:action');
    });
  });

  // ==========================================================================
  // getRequiredPermission()
  // ==========================================================================

  describe('getRequiredPermission()', () => {
    describe('Device paths', () => {
      it('should return devices:read for GET /devices', () => {
        expect(getRequiredPermission('/api/v2/devices', 'GET')).toBe('devices:read');
      });

      it('should return devices:create for POST /devices', () => {
        expect(getRequiredPermission('/api/v2/devices', 'POST')).toBe('devices:create');
      });

      it('should return devices:update for PATCH /devices/id', () => {
        expect(getRequiredPermission('/api/v2/devices/device_001', 'PATCH')).toBe('devices:update');
      });

      it('should return devices:delete for DELETE /devices/id', () => {
        expect(getRequiredPermission('/api/v2/devices/device_001', 'DELETE')).toBe('devices:delete');
      });
    });

    describe('Readings paths', () => {
      it('should return readings:read for GET /readings', () => {
        expect(getRequiredPermission('/api/v2/readings', 'GET')).toBe('readings:read');
      });

      it('should return readings:create for POST /readings/ingest', () => {
        expect(getRequiredPermission('/api/v2/readings/ingest', 'POST')).toBe('readings:create');
      });

      it('should return readings:read for PUT on readings', () => {
        expect(getRequiredPermission('/api/v2/readings/latest', 'PUT')).toBe('readings:read');
      });
    });

    describe('Analytics paths', () => {
      it('should return analytics:read for any analytics path', () => {
        expect(getRequiredPermission('/api/v2/analytics/health', 'GET')).toBe('analytics:read');
        expect(getRequiredPermission('/api/v2/analytics/anomalies', 'GET')).toBe('analytics:read');
        expect(getRequiredPermission('/api/v2/analytics/energy', 'GET')).toBe('analytics:read');
      });
    });

    describe('Audit paths', () => {
      it('should return audit:read for audit paths', () => {
        expect(getRequiredPermission('/api/v2/audit', 'GET')).toBe('audit:read');
      });
    });

    describe('Admin paths', () => {
      it('should return admin:settings for admin paths', () => {
        expect(getRequiredPermission('/api/admin/settings', 'GET')).toBe('admin:settings');
        expect(getRequiredPermission('/api/admin/keys', 'POST')).toBe('admin:settings');
      });
    });

    describe('Metadata paths', () => {
      it('should return devices:read for metadata paths', () => {
        expect(getRequiredPermission('/api/v2/metadata', 'GET')).toBe('devices:read');
      });
    });

    describe('Unknown paths', () => {
      it('should return null for unrecognized paths', () => {
        expect(getRequiredPermission('/api/unknown', 'GET')).toBeNull();
        expect(getRequiredPermission('/health', 'GET')).toBeNull();
        expect(getRequiredPermission('/', 'GET')).toBeNull();
      });
    });
  });
});
