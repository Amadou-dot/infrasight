/**
 * Authentication Integration Tests
 *
 * Tests for API route authentication protection.
 * Verifies that:
 * - Protected routes return 401 when not authenticated
 * - Protected routes work when authenticated
 * - Public routes remain accessible without auth
 * - Audit trails include authenticated user info
 */

import { NextRequest } from 'next/server';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createDeviceInput, resetCounters } from '../../setup/factories';

// Import route handlers
import { GET as getDevices, POST as createDevice } from '@/app/api/v2/devices/route';
import {
  GET as getDevice,
  PATCH as updateDevice,
  DELETE as deleteDevice,
} from '@/app/api/v2/devices/[id]/route';
import { POST as ingestReadings } from '@/app/api/v2/readings/ingest/route';
import { GET as simulateReadings } from '@/app/api/v2/cron/simulate/route';

import { auth, currentUser } from '@clerk/nextjs/server';

// Mock Clerk auth module
jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
}));

const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockCurrentUser = currentUser as jest.MockedFunction<typeof currentUser>;

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock authenticated user state
 */
function mockAuthenticated(userId = 'user_test123', email = 'test@example.com') {
  mockAuth.mockResolvedValue({ userId } as Awaited<ReturnType<typeof auth>>);
  mockCurrentUser.mockResolvedValue({
    id: userId,
    fullName: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    primaryEmailAddressId: 'email_1',
    emailAddresses: [
      {
        id: 'email_1',
        emailAddress: email,
      },
    ],
  } as Awaited<ReturnType<typeof currentUser>>);
}

/**
 * Mock unauthenticated state
 */
function mockUnauthenticated() {
  mockAuth.mockResolvedValue({ userId: null } as Awaited<ReturnType<typeof auth>>);
  mockCurrentUser.mockResolvedValue(null);
}

/**
 * Create mock GET request
 */
function createMockGetRequest(
  path: string,
  searchParams: Record<string, string> = {}
): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

/**
 * Create mock POST/PATCH request
 */
function createMockMutationRequest(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): NextRequest {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  return new NextRequest(`http://localhost:3000${path}`, options);
}

/**
 * Parse JSON response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

// ============================================================================
// Tests
// ============================================================================

describe('Authentication Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Unauthenticated Access Tests
  // ==========================================================================

  describe('Unauthenticated Access', () => {
    beforeEach(() => {
      mockUnauthenticated();
    });

    describe('GET /api/v2/devices (List)', () => {
      it('should return 401 when not authenticated', async () => {
        const request = createMockGetRequest('/api/v2/devices');
        const response = await getDevices(request);
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('UNAUTHORIZED');
      });
    });

    describe('POST /api/v2/devices (Create)', () => {
      it('should return 401 when not authenticated', async () => {
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_auth_test_1';

        const request = createMockMutationRequest('/api/v2/devices', 'POST', deviceInput);
        const response = await createDevice(request);
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('UNAUTHORIZED');
      });
    });

    describe('GET /api/v2/devices/[id] (Single)', () => {
      it('should return 401 when not authenticated', async () => {
        const request = createMockGetRequest('/api/v2/devices/device_123');
        const params = Promise.resolve({ id: 'device_123' });
        const response = await getDevice(request, { params });
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('UNAUTHORIZED');
      });
    });

    describe('PATCH /api/v2/devices/[id] (Update)', () => {
      it('should return 401 when not authenticated', async () => {
        const request = createMockMutationRequest('/api/v2/devices/device_123', 'PATCH', {
          status: 'maintenance',
        });
        const params = Promise.resolve({ id: 'device_123' });
        const response = await updateDevice(request, { params });
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('UNAUTHORIZED');
      });
    });

    describe('DELETE /api/v2/devices/[id] (Delete)', () => {
      it('should return 401 when not authenticated', async () => {
        const request = createMockMutationRequest('/api/v2/devices/device_123', 'DELETE');
        const params = Promise.resolve({ id: 'device_123' });
        const response = await deleteDevice(request, { params });
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('UNAUTHORIZED');
      });
    });

    describe('POST /api/v2/readings/ingest (Ingest)', () => {
      it('should return 401 when not authenticated', async () => {
        const request = createMockMutationRequest('/api/v2/readings/ingest', 'POST', {
          readings: [
            {
              device_id: 'device_001',
              type: 'temperature',
              unit: 'celsius',
              value: 22.5,
              timestamp: new Date().toISOString(),
            },
          ],
        });
        const response = await ingestReadings(request);
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('UNAUTHORIZED');
      });
    });
  });

  // ==========================================================================
  // Public Route Tests
  // ==========================================================================

  describe('Public Routes', () => {
    beforeEach(() => {
      mockUnauthenticated();
    });

    describe('GET /api/v2/cron/simulate', () => {
      it('should be accessible without authentication (no 401)', async () => {
        // Create a test device first so simulate has something to work with
        mockAuthenticated();
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_simulate_test';
        await DeviceV2.create(deviceInput);

        // Now test simulate without auth
        mockUnauthenticated();
        const response = await simulateReadings();

        // The key test: should NOT return 401 (auth not required)
        // May return 500 due to Pusher not being available in tests, or 200/404
        expect(response.status).not.toBe(401);
      });
    });
  });

  // ==========================================================================
  // Authenticated Access Tests
  // ==========================================================================

  describe('Authenticated Access', () => {
    const testEmail = 'authenticated@example.com';
    const testUserId = 'user_auth_test_456';

    beforeEach(() => {
      mockAuthenticated(testUserId, testEmail);
    });

    describe('GET /api/v2/devices (List)', () => {
      it('should return 200 when authenticated', async () => {
        const request = createMockGetRequest('/api/v2/devices');
        const response = await getDevices(request);
        const data = await parseResponse<{ success: boolean }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
      });
    });

    describe('POST /api/v2/devices (Create)', () => {
      it('should return 201 when authenticated', async () => {
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_auth_create_test';

        const request = createMockMutationRequest('/api/v2/devices', 'POST', deviceInput);
        const response = await createDevice(request);
        const data = await parseResponse<{ success: boolean; data: { _id: string } }>(response);

        expect(response.status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.data._id).toBe('device_auth_create_test');
      });

      it('should track authenticated user in audit trail', async () => {
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_audit_test';

        const request = createMockMutationRequest('/api/v2/devices', 'POST', deviceInput);
        await createDevice(request);

        // Verify audit trail
        const device = await DeviceV2.findById('device_audit_test').lean();
        expect(device?.audit?.created_by).toBe(testEmail);
        expect(device?.audit?.updated_by).toBe(testEmail);
      });
    });

    describe('PATCH /api/v2/devices/[id] (Update)', () => {
      it('should return 200 when authenticated', async () => {
        // Create device first
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_update_auth_test';
        await DeviceV2.create(deviceInput);

        const request = createMockMutationRequest(
          '/api/v2/devices/device_update_auth_test',
          'PATCH',
          { status: 'maintenance' }
        );
        const params = Promise.resolve({ id: 'device_update_auth_test' });
        const response = await updateDevice(request, { params });
        const data = await parseResponse<{ success: boolean }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
      });

      it('should track authenticated user in audit trail on update', async () => {
        // Create device with system user first
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_update_audit_test';
        await DeviceV2.create({
          ...deviceInput,
          audit: {
            created_at: new Date(),
            created_by: 'system',
            updated_at: new Date(),
            updated_by: 'system',
          },
        });

        const request = createMockMutationRequest(
          '/api/v2/devices/device_update_audit_test',
          'PATCH',
          { status: 'maintenance' }
        );
        const params = Promise.resolve({ id: 'device_update_audit_test' });
        await updateDevice(request, { params });

        // Verify audit trail was updated
        const device = await DeviceV2.findById('device_update_audit_test').lean();
        expect(device?.audit?.updated_by).toBe(testEmail);
      });
    });

    describe('DELETE /api/v2/devices/[id] (Delete)', () => {
      it('should return 200 when authenticated', async () => {
        // Create device first
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_delete_auth_test';
        await DeviceV2.create(deviceInput);

        const request = createMockMutationRequest(
          '/api/v2/devices/device_delete_auth_test',
          'DELETE'
        );
        const params = Promise.resolve({ id: 'device_delete_auth_test' });
        const response = await deleteDevice(request, { params });
        const data = await parseResponse<{ success: boolean }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
      });

      it('should track authenticated user in audit trail on delete', async () => {
        // Create device first
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_delete_audit_test';
        await DeviceV2.create(deviceInput);

        const request = createMockMutationRequest(
          '/api/v2/devices/device_delete_audit_test',
          'DELETE'
        );
        const params = Promise.resolve({ id: 'device_delete_audit_test' });
        await deleteDevice(request, { params });

        // Verify audit trail shows who deleted
        const device = await DeviceV2.findById('device_delete_audit_test').lean();
        expect(device?.audit?.deleted_by).toBe(testEmail);
      });
    });

    describe('POST /api/v2/readings/ingest (Ingest)', () => {
      it('should return 201 when authenticated with valid data', async () => {
        // Create device first
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_ingest_auth_test';
        deviceInput.type = 'temperature';
        await DeviceV2.create(deviceInput);

        const request = createMockMutationRequest('/api/v2/readings/ingest', 'POST', {
          readings: [
            {
              device_id: 'device_ingest_auth_test',
              type: 'temperature',
              unit: 'celsius',
              value: 22.5,
              timestamp: new Date().toISOString(),
            },
          ],
        });
        const response = await ingestReadings(request);
        const data = await parseResponse<{
          success: boolean;
          data: { inserted: number; submitted_by: string };
        }>(response);

        expect(response.status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.data.inserted).toBe(1);
        expect(data.data.submitted_by).toBe(testEmail);
      });

      it('should track authenticated user in response', async () => {
        // Create device first
        const deviceInput = createDeviceInput();
        deviceInput._id = 'device_ingest_audit_test';
        deviceInput.type = 'temperature';
        await DeviceV2.create(deviceInput);

        const request = createMockMutationRequest('/api/v2/readings/ingest', 'POST', {
          readings: [
            {
              device_id: 'device_ingest_audit_test',
              type: 'temperature',
              unit: 'celsius',
              value: 22.5,
              timestamp: new Date().toISOString(),
            },
          ],
        });
        const response = await ingestReadings(request);
        const data = await parseResponse<{
          data: { submitted_by: string; submitted_at: string };
        }>(response);

        expect(data.data.submitted_by).toBe(testEmail);
        expect(data.data.submitted_at).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle user without email gracefully (use userId)', async () => {
      // Mock user with no email
      mockAuth.mockResolvedValue({ userId: 'user_no_email' } as Awaited<ReturnType<typeof auth>>);
      mockCurrentUser.mockResolvedValue({
        id: 'user_no_email',
        fullName: 'No Email User',
        firstName: 'No',
        lastName: 'Email',
        primaryEmailAddressId: null,
        emailAddresses: [],
      } as unknown as Awaited<ReturnType<typeof currentUser>>);

      const deviceInput = createDeviceInput();
      deviceInput._id = 'device_no_email_test';

      const request = createMockMutationRequest('/api/v2/devices', 'POST', deviceInput);
      const response = await createDevice(request);

      expect(response.status).toBe(201);

      // Verify audit uses userId when email not available
      const device = await DeviceV2.findById('device_no_email_test').lean();
      expect(device?.audit?.created_by).toBe('user_no_email');
    });

    it('should return proper error format for 401', async () => {
      mockUnauthenticated();

      const request = createMockGetRequest('/api/v2/devices');
      const response = await getDevices(request);
      const data = await parseResponse<{
        success: boolean;
        error: { code: string; message: string; statusCode: number };
      }>(response);

      expect(data).toMatchObject({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: expect.stringContaining('Authentication required'),
          statusCode: 401,
        },
      });
    });
  });
});
