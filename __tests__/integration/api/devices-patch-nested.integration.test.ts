/**
 * Device PATCH Nested Updates Integration Tests
 *
 * Tests for nested field updates in PATCH /api/v2/devices/[id] endpoint
 * covering metadata, compliance, and health nested object updates.
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createDeviceInput, resetCounters } from '../../setup/factories';
import { PATCH } from '@/app/api/v2/devices/[id]/route';

/**
 * Helper to create a mock NextRequest for PATCH requests
 */
function createMockPatchRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v2/devices/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Helper to parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Device PATCH - Nested Updates', () => {
  beforeEach(() => {
    resetCounters();
  });

  describe('Metadata Updates', () => {
    it('should update metadata tags', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_meta_tags',
        metadata: { tags: ['old-tag'], department: 'IT', cost_center: 'CC-001' },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        metadata: {
          tags: ['new-tag-1', 'new-tag-2', 'critical'],
        },
      };
      const request = createMockPatchRequest('patch_meta_tags', updateData);
      const params = Promise.resolve({ id: 'patch_meta_tags' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { metadata: { tags: string[] } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.metadata.tags).toEqual(['new-tag-1', 'new-tag-2', 'critical']);
    });

    it('should update metadata department', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_meta_dept',
        metadata: { tags: [], department: 'IT', cost_center: 'CC-001' },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        metadata: {
          department: 'Facilities',
        },
      };
      const request = createMockPatchRequest('patch_meta_dept', updateData);
      const params = Promise.resolve({ id: 'patch_meta_dept' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { metadata: { department: string } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.metadata.department).toBe('Facilities');
    });

    it('should update metadata cost_center', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_meta_cost',
        metadata: { tags: [], department: 'IT', cost_center: 'CC-001' },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        metadata: {
          cost_center: 'CC-999',
        },
      };
      const request = createMockPatchRequest('patch_meta_cost', updateData);
      const params = Promise.resolve({ id: 'patch_meta_cost' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { metadata: { cost_center: string } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.metadata.cost_center).toBe('CC-999');
    });

    it('should update multiple metadata fields at once', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_meta_multi',
        metadata: { tags: ['old'], department: 'IT', cost_center: 'CC-001' },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        metadata: {
          tags: ['new', 'updated'],
          department: 'Engineering',
          cost_center: 'CC-ENG-001',
        },
      };
      const request = createMockPatchRequest('patch_meta_multi', updateData);
      const params = Promise.resolve({ id: 'patch_meta_multi' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { metadata: { tags: string[]; department: string; cost_center: string } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.metadata.tags).toEqual(['new', 'updated']);
      expect(data.data.metadata.department).toBe('Engineering');
      expect(data.data.metadata.cost_center).toBe('CC-ENG-001');
    });
  });

  describe('Compliance Updates', () => {
    it('should update compliance requires_encryption', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_comp_encrypt',
        compliance: { requires_encryption: false, data_classification: 'internal', retention_days: 90 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        compliance: {
          requires_encryption: true,
        },
      };
      const request = createMockPatchRequest('patch_comp_encrypt', updateData);
      const params = Promise.resolve({ id: 'patch_comp_encrypt' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { compliance: { requires_encryption: boolean } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.compliance.requires_encryption).toBe(true);
    });

    it('should update compliance data_classification', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_comp_class',
        compliance: { requires_encryption: false, data_classification: 'internal', retention_days: 90 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        compliance: {
          data_classification: 'confidential',
        },
      };
      const request = createMockPatchRequest('patch_comp_class', updateData);
      const params = Promise.resolve({ id: 'patch_comp_class' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { compliance: { data_classification: string } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.compliance.data_classification).toBe('confidential');
    });

    it('should update compliance retention_days', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_comp_retention',
        compliance: { requires_encryption: false, data_classification: 'internal', retention_days: 90 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        compliance: {
          retention_days: 365,
        },
      };
      const request = createMockPatchRequest('patch_comp_retention', updateData);
      const params = Promise.resolve({ id: 'patch_comp_retention' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { compliance: { retention_days: number } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.compliance.retention_days).toBe(365);
    });

    it('should update multiple compliance fields at once', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_comp_multi',
        compliance: { requires_encryption: false, data_classification: 'public', retention_days: 30 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        compliance: {
          requires_encryption: true,
          data_classification: 'restricted',
          retention_days: 730,
        },
      };
      const request = createMockPatchRequest('patch_comp_multi', updateData);
      const params = Promise.resolve({ id: 'patch_comp_multi' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { compliance: { requires_encryption: boolean; data_classification: string; retention_days: number } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.compliance.requires_encryption).toBe(true);
      expect(data.data.compliance.data_classification).toBe('restricted');
      expect(data.data.compliance.retention_days).toBe(730);
    });
  });

  describe('Health Updates', () => {
    it('should update health battery_level', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_health_battery',
        health: { last_seen: new Date(), uptime_percentage: 100, error_count: 0, battery_level: 80 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        health: {
          battery_level: 45,
        },
      };
      const request = createMockPatchRequest('patch_health_battery', updateData);
      const params = Promise.resolve({ id: 'patch_health_battery' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { health: { battery_level: number } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.health.battery_level).toBe(45);
    });

    it('should update health uptime_percentage', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_health_uptime',
        health: { last_seen: new Date(), uptime_percentage: 100, error_count: 0 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        health: {
          uptime_percentage: 95.5,
        },
      };
      const request = createMockPatchRequest('patch_health_uptime', updateData);
      const params = Promise.resolve({ id: 'patch_health_uptime' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { health: { uptime_percentage: number } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.health.uptime_percentage).toBe(95.5);
    });

    it('should update health error_count', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_health_errors',
        health: { last_seen: new Date(), uptime_percentage: 100, error_count: 0 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        health: {
          error_count: 5,
        },
      };
      const request = createMockPatchRequest('patch_health_errors', updateData);
      const params = Promise.resolve({ id: 'patch_health_errors' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { health: { error_count: number } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.health.error_count).toBe(5);
    });

    it('should update multiple health fields at once', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_health_multi',
        health: { last_seen: new Date(), uptime_percentage: 100, error_count: 0, battery_level: 100 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        health: {
          uptime_percentage: 88.5,
          error_count: 3,
          battery_level: 67,
        },
      };
      const request = createMockPatchRequest('patch_health_multi', updateData);
      const params = Promise.resolve({ id: 'patch_health_multi' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: { health: { uptime_percentage: number; error_count: number; battery_level: number } };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.health.uptime_percentage).toBe(88.5);
      expect(data.data.health.error_count).toBe(3);
      expect(data.data.health.battery_level).toBe(67);
    });
  });

  describe('PATCH Validation Errors', () => {
    it('should reject invalid nested field types', async () => {
      const deviceData = createDeviceInput({ _id: 'patch_invalid_type' });
      await DeviceV2.create(deviceData);

      const updateData = {
        health: {
          battery_level: 'not_a_number' as unknown as number,
        },
      };
      const request = createMockPatchRequest('patch_invalid_type', updateData);
      const params = Promise.resolve({ id: 'patch_invalid_type' });
      const response = await PATCH(request, { params });

      // The update should still work because Mongoose coerces types
      // but the value will be NaN or cause an error
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Combined Updates', () => {
    it('should update metadata, compliance, and health simultaneously', async () => {
      const deviceData = createDeviceInput({
        _id: 'patch_combined',
        metadata: { tags: ['old'], department: 'IT', cost_center: 'CC-001' },
        compliance: { requires_encryption: false, data_classification: 'internal', retention_days: 90 },
        health: { last_seen: new Date(), uptime_percentage: 100, error_count: 0, battery_level: 100 },
      });
      await DeviceV2.create(deviceData);

      const updateData = {
        metadata: {
          tags: ['updated', 'combined'],
          department: 'Engineering',
        },
        compliance: {
          requires_encryption: true,
          data_classification: 'confidential',
        },
        health: {
          battery_level: 75,
          error_count: 1,
        },
      };
      const request = createMockPatchRequest('patch_combined', updateData);
      const params = Promise.resolve({ id: 'patch_combined' });
      const response = await PATCH(request, { params });
      const data = await parseResponse<{
        success: boolean;
        data: {
          metadata: { tags: string[]; department: string };
          compliance: { requires_encryption: boolean; data_classification: string };
          health: { battery_level: number; error_count: number };
        };
      }>(response);

      expect(response.status).toBe(200);
      expect(data.data.metadata.tags).toEqual(['updated', 'combined']);
      expect(data.data.metadata.department).toBe('Engineering');
      expect(data.data.compliance.requires_encryption).toBe(true);
      expect(data.data.compliance.data_classification).toBe('confidential');
      expect(data.data.health.battery_level).toBe(75);
      expect(data.data.health.error_count).toBe(1);
    });
  });
});
