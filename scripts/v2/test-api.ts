#!/usr/bin/env npx tsx
/**
 * V2 API Test Script
 *
 * Tests all V2 API endpoints to verify they work correctly.
 * Run with: pnpm tsx scripts/v2/test-api.ts
 *
 * Prerequisites:
 * - MongoDB running with MONGODB_URI set
 * - Dev server running on localhost:3000
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  endpoint: string;
  method: string;
  passed: boolean;
  status: number;
  responseTime: number;
  error?: string;
}

const results: TestResult[] = [];

// ============================================================================
// Test Utilities
// ============================================================================

async function testEndpoint(
  name: string,
  method: string,
  path: string,
  options?: {
    body?: unknown;
    expectedStatus?: number;
    validateResponse?: (data: unknown) => boolean;
  }
): Promise<TestResult> {
  const endpoint = `${BASE_URL}${path}`;
  const expectedStatus = options?.expectedStatus || 200;
  const startTime = Date.now();

  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const responseTime = Date.now() - startTime;
    const data = await response.json();

    let passed = response.status === expectedStatus;
    
    if (passed && options?.validateResponse) 
      passed = options.validateResponse(data);
    

    const result: TestResult = {
      name,
      endpoint: `${method} ${path}`,
      method,
      passed,
      status: response.status,
      responseTime,
      error: passed ? undefined : `Expected ${expectedStatus}, got ${response.status}`,
    };

    results.push(result);
    return result;
  } catch (error) {
    const result: TestResult = {
      name,
      endpoint: `${method} ${path}`,
      method,
      passed: false,
      status: 0,
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    results.push(result);
    return result;
  }
}

function logResult(result: TestResult): void {
  const icon = result.passed ? '✅' : '❌';
  const time = `${result.responseTime}ms`;
  console.log(`${icon} ${result.name}`);
  console.log(`   ${result.endpoint} [${result.status}] ${time}`);
  if (result.error) 
    console.log(`   Error: ${result.error}`);
  
}

// ============================================================================
// Test Data
// ============================================================================

const testDeviceId = `test_device_${Date.now()}`;
const testDevice = {
  _id: testDeviceId,
  serial_number: `SN-TEST-${Date.now()}`,
  manufacturer: 'Test Corp',
  device_model: 'TestSensor-3000',
  firmware_version: '1.0.0',
  type: 'temperature',
  configuration: {
    threshold_warning: 25,
    threshold_critical: 30,
    sampling_interval: 60,
    calibration_offset: 0,
  },
  location: {
    building_id: 'HQ',
    floor: 1,
    room_name: 'Test Room',
  },
  metadata: {
    tags: ['test', 'automated'],
    department: 'Engineering',
  },
  compliance: {
    requires_encryption: false,
    data_classification: 'internal',
    retention_days: 30,
  },
  audit: {
    created_by: 'test-script',
  },
};

const testReadings = {
  readings: [
    {
      device_id: testDeviceId,
      type: 'temperature',
      unit: 'celsius',
      source: 'simulation',
      timestamp: new Date().toISOString(),
      value: 22.5,
    },
    {
      device_id: testDeviceId,
      type: 'temperature',
      unit: 'celsius',
      source: 'simulation',
      timestamp: new Date(Date.now() - 60000).toISOString(),
      value: 22.3,
    },
  ],
};

// ============================================================================
// Tests
// ============================================================================

async function runTests(): Promise<void> {
  console.log('🧪 Starting V2 API Tests\n');
  console.log(`Base URL: ${BASE_URL}\n`);
  console.log('='.repeat(60));

  // ---------------------------------------------------------------------------
  // Device Tests
  // ---------------------------------------------------------------------------
  console.log('\n📱 Device Endpoints\n');

  // Create device
  logResult(
    await testEndpoint('Create Device', 'POST', '/api/v2/devices', {
      body: testDevice,
      expectedStatus: 201,
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean; data?: { _id: string } };
        return d.success === true && d.data?._id === testDeviceId;
      },
    })
  );

  // List devices
  logResult(
    await testEndpoint('List Devices', 'GET', '/api/v2/devices', {
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean; data?: unknown[] };
        return d.success === true && Array.isArray(d.data);
      },
    })
  );

  // List with filters
  logResult(
    await testEndpoint(
      'List Devices with Filters',
      'GET',
      '/api/v2/devices?type=temperature&status=active&limit=5'
    )
  );

  // Get single device
  logResult(
    await testEndpoint('Get Device by ID', 'GET', `/api/v2/devices/${testDeviceId}`, {
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean; data?: { _id: string } };
        return d.success === true && d.data?._id === testDeviceId;
      },
    })
  );

  // Update device
  logResult(
    await testEndpoint('Update Device', 'PATCH', `/api/v2/devices/${testDeviceId}`, {
      body: {
        configuration: { threshold_warning: 26 },
        updated_by: 'test-script',
      },
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean };
        return d.success === true;
      },
    })
  );

  // Get device history
  logResult(
    await testEndpoint('Get Device History', 'GET', `/api/v2/devices/${testDeviceId}/history`)
  );

  // ---------------------------------------------------------------------------
  // Readings Tests
  // ---------------------------------------------------------------------------
  console.log('\n📊 Readings Endpoints\n');

  // Ingest readings
  logResult(
    await testEndpoint('Ingest Readings', 'POST', '/api/v2/readings/ingest', {
      body: testReadings,
      expectedStatus: 201,
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean; data?: { inserted: number } };
        return d.success === true && d.data?.inserted === 2;
      },
    })
  );

  // List readings
  logResult(
    await testEndpoint(
      'List Readings',
      'GET',
      `/api/v2/readings?device_id=${testDeviceId}`,
      {
        validateResponse: (data: unknown) => {
          const d = data as { success: boolean; data?: unknown[] };
          return d.success === true && Array.isArray(d.data);
        },
      }
    )
  );

  // Latest readings
  logResult(
    await testEndpoint(
      'Get Latest Readings',
      'GET',
      `/api/v2/readings/latest?device_ids=${testDeviceId}`,
      {
        validateResponse: (data: unknown) => {
          const d = data as { success: boolean; data?: { readings: unknown[] } };
          return d.success === true && Array.isArray(d.data?.readings);
        },
      }
    )
  );

  // ---------------------------------------------------------------------------
  // Analytics Tests
  // ---------------------------------------------------------------------------
  console.log('\n📈 Analytics Endpoints\n');

  // Energy analytics
  logResult(
    await testEndpoint('Energy Analytics', 'GET', '/api/v2/analytics/energy', {
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean };
        return d.success === true;
      },
    })
  );

  // Health analytics
  logResult(
    await testEndpoint('Health Analytics', 'GET', '/api/v2/analytics/health', {
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean; data?: { summary: unknown } };
        return d.success === true && d.data?.summary !== undefined;
      },
    })
  );

  // Anomaly analytics
  logResult(
    await testEndpoint('Anomaly Analytics', 'GET', '/api/v2/analytics/anomalies', {
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean };
        return d.success === true;
      },
    })
  );

  // ---------------------------------------------------------------------------
  // Metadata & Audit Tests
  // ---------------------------------------------------------------------------
  console.log('\n🔍 Metadata & Audit Endpoints\n');

  // Metadata
  logResult(
    await testEndpoint('Get Metadata', 'GET', '/api/v2/metadata', {
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean; data?: { schema_info: unknown } };
        return d.success === true && d.data?.schema_info !== undefined;
      },
    })
  );

  // Metadata with stats
  logResult(
    await testEndpoint('Get Metadata with Stats', 'GET', '/api/v2/metadata?include_stats=true')
  );

  // Audit
  logResult(
    await testEndpoint('Get Audit Trail', 'GET', '/api/v2/audit', {
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean; data?: { entries: unknown[] } };
        return d.success === true && Array.isArray(d.data?.entries);
      },
    })
  );

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  console.log('\n🧹 Cleanup\n');

  // Delete test device (soft delete)
  logResult(
    await testEndpoint('Delete Device', 'DELETE', `/api/v2/devices/${testDeviceId}`, {
      body: { deleted_by: 'test-script', reason: 'Test cleanup' },
      validateResponse: (data: unknown) => {
        const d = data as { success: boolean };
        return d.success === true;
      },
    })
  );

  // Verify soft delete
  logResult(
    await testEndpoint(
      'Verify Soft Delete',
      'GET',
      `/api/v2/devices/${testDeviceId}`,
      {
        expectedStatus: 410, // Gone
      }
    )
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Summary\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const avgTime = Math.round(results.reduce((sum, r) => sum + r.responseTime, 0) / total);

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Average Response Time: ${avgTime}ms`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
