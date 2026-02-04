/**
 * Report Validation Schema Tests
 *
 * Tests for Zod validation schemas in report.validation.ts
 */

import { reportGenerateQuerySchema } from '@/lib/validations/v2/report.validation';

describe('Report Validation Schemas', () => {
  // ==========================================================================
  // REPORT GENERATE QUERY SCHEMA TESTS
  // ==========================================================================

  describe('reportGenerateQuerySchema', () => {
    describe('valid inputs', () => {
      it('should accept scope="all" without building_id', () => {
        const query = { scope: 'all' };
        const result = reportGenerateQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.scope).toBe('all');
          expect(result.data.building_id).toBeUndefined();
        }
      });

      it('should accept scope="all" with optional building_id', () => {
        const query = { scope: 'all', building_id: 'BLDG-001' };
        const result = reportGenerateQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.scope).toBe('all');
          expect(result.data.building_id).toBe('BLDG-001');
        }
      });

      it('should accept scope="building" with building_id', () => {
        const query = { scope: 'building', building_id: 'BLDG-001' };
        const result = reportGenerateQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.scope).toBe('building');
          expect(result.data.building_id).toBe('BLDG-001');
        }
      });

      it('should accept building_id with various formats', () => {
        const validBuildingIds = ['BLDG-001', 'building_001', 'HQ-Main', '123'];
        for (const building_id of validBuildingIds) {
          const query = { scope: 'building', building_id };
          const result = reportGenerateQuerySchema.safeParse(query);
          expect(result.success).toBe(true);
        }
      });
    });

    describe('invalid inputs', () => {
      it('should reject scope="building" without building_id', () => {
        const query = { scope: 'building' };
        const result = reportGenerateQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].path).toContain('building_id');
          expect(result.error.issues[0].message).toBe(
            'building_id is required when scope is "building"'
          );
        }
      });

      it('should reject invalid scope values', () => {
        const invalidScopes = ['ALL', 'BUILDING', 'invalid', '', 'global', 'floor'];
        for (const scope of invalidScopes) {
          const query = { scope };
          const result = reportGenerateQuerySchema.safeParse(query);
          expect(result.success).toBe(false);
        }
      });

      it('should reject missing scope', () => {
        const query = { building_id: 'BLDG-001' };
        const result = reportGenerateQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
      });

      it('should reject empty object', () => {
        const query = {};
        const result = reportGenerateQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
      });

      it('should reject null values', () => {
        const query = { scope: null };
        const result = reportGenerateQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should accept scope="building" with empty string building_id (but fail refinement)', () => {
        const query = { scope: 'building', building_id: '' };
        const result = reportGenerateQuerySchema.safeParse(query);
        // Empty string is falsy, so refinement should fail
        expect(result.success).toBe(false);
      });

      it('should ignore extra properties', () => {
        const query = { scope: 'all', extra: 'ignored', another: 123 };
        const result = reportGenerateQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).not.toHaveProperty('extra');
          expect(result.data).not.toHaveProperty('another');
        }
      });
    });
  });
});
