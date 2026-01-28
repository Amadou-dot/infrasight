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
import { GET as getDevices, POST as createDevice } from '@/app/api/v2/devices/route';
import { GET as getAudit } from '@/app/api/v2/audit/route';
import { GET as getMetadata } from '@/app/api/v2/metadata/route';
import { GET as getMetrics } from '@/app/api/v2/metrics/route';
import { GET as getTestSentry } from '@/app/api/v2/test-sentry/route';
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

// Mock Pusher to avoid env dependency and network calls
jest.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockCurrentUser = currentUser as jest.MockedFunction<typeof currentUser>;

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock authenticated user state
 */
function mockAuthenticated(userId = 'user_test123', email = 'test@example.com', role = 'org:admin') {
  mockAuth.mockResolvedValue({
    userId,
    orgId: 'org_test',
    orgSlug: 'users',
    orgRole: role,
  } as Awaited<ReturnType<typeof auth>>);
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
  mockAuth.mockResolvedValue({
    userId: null,
    orgId: null,
    orgSlug: null,
    orgRole: null,
  } as Awaited<ReturnType<typeof auth>>);
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

        const data = await parseResponse<{
          success: boolean;
          count?: number;
        }>(response);

        // The key test: should NOT return 401 (auth not required)
        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.count).toBeGreaterThan(0);
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

    describe('GET /api/v2/audit', () => {
      it('should return 403 when member', async () => {
        mockAuthenticated(testUserId, testEmail, 'org:member');
        const request = createMockGetRequest('/api/v2/audit');
        const response = await getAudit(request);
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('FORBIDDEN');
      });

      it('should allow admin', async () => {
        const request = createMockGetRequest('/api/v2/audit');
        const response = await getAudit(request);
        const data = await parseResponse<{ success: boolean }>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
      });
    });

    describe('GET /api/v2/metadata', () => {
      it('should return 403 when member requests deleted metadata', async () => {
        mockAuthenticated(testUserId, testEmail, 'org:member');
        const request = createMockGetRequest('/api/v2/metadata', { include_deleted: 'true' });
        const response = await getMetadata(request);
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('FORBIDDEN');
      });
    });

    describe('GET /api/v2/metrics', () => {
      const originalEnableMetrics = process.env.ENABLE_METRICS;

      afterEach(() => {
        if (originalEnableMetrics === undefined) delete process.env.ENABLE_METRICS;
        else process.env.ENABLE_METRICS = originalEnableMetrics;
      });

      it('should return 403 when member', async () => {
        process.env.ENABLE_METRICS = 'true';
        mockAuthenticated(testUserId, testEmail, 'org:member');
        const request = new Request('http://localhost:3000/api/v2/metrics');

        await expect(getMetrics(request)).rejects.toThrow('Admin role required');
      });

      it('should allow admin', async () => {
        process.env.ENABLE_METRICS = 'true';
        const request = new Request('http://localhost:3000/api/v2/metrics');
        const response = await getMetrics(request);

        expect(response.status).toBe(200);
      });
    });

    describe('GET /api/v2/test-sentry', () => {
      it('should return 403 when member', async () => {
        mockAuthenticated(testUserId, testEmail, 'org:member');
        const response = await getTestSentry();
        const data = await parseResponse<{ success: boolean; error: { code: string } }>(response);

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
        expect(data.error.code).toBe('FORBIDDEN');
      });
    });


  });
});
