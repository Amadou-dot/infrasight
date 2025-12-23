#!/usr/bin/env npx tsx
/**
 * Phase 1 Endpoint Testing Script
 *
 * Tests the new predictive analytics endpoints:
 * - /api/v2/analytics/maintenance-forecast
 * - /api/v2/analytics/temperature-correlation
 * - Extended health endpoint with predictive_maintenance
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import mongoose from 'mongoose';
import DeviceV2 from '../../models/v2/DeviceV2';
import ReadingV2 from '../../models/v2/ReadingV2';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

let BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if server is running and find the correct port
 */
async function findServerUrl(): Promise<string> {
  const ports = [3000, 3001, 3002];
  
  for (const port of ports) {
    const url = `http://localhost:${port}`;
    try {
      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`${url}/api/v2/analytics/health`, {
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.status !== 404) {
        console.log(`✅ Found server running on port ${port}`);
        return url;
      }
    } catch (error) {
      // Port not reachable, try next
    }
  }
  
  throw new Error('No server found on ports 3000, 3001, or 3002. Please start the dev server with: pnpm dev');
}

async function testEndpoint(
  name: string,
  url: string,
  expectedFields: string[]
): Promise<boolean> {
  try {
    console.log(`\n🔍 Testing: ${name}`);
    console.log(`   URL: ${url}`);

    const response = await fetch(`${BASE_URL}${url}`);
    
    // Check if response has content
    const text = await response.text();
    
    if (!text || text.trim() === '') {
      console.log(`   ❌ Empty response from server`);
      console.log(`   Status: ${response.status}`);
      console.log(`   This could mean:`);
      console.log(`      - The endpoint crashed silently`);
      console.log(`      - The server is not running`);
      console.log(`      - The route handler has an error`);
      return false;
    }

    // Try to parse JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.log(`   ❌ Failed to parse JSON response`);
      console.log(`   Response text:`, text.substring(0, 200));
      return false;
    }

    if (!response.ok) {
      console.log(`   ❌ Failed with status ${response.status}`);
      console.log(`   Error:`, data);
      return false;
    }

    if (!data.success) {
      console.log(`   ❌ Response not successful`);
      console.log(`   Data:`, data);
      return false;
    }

    // Check expected fields
    const missingFields = expectedFields.filter((field) => {
      const keys = field.split('.');
      let value: any = data.data;
      for (const key of keys) {
        if (value === undefined || value === null) return true;
        value = value[key];
      }
      return value === undefined;
    });

    if (missingFields.length > 0) {
      console.log(`   ⚠️  Missing fields:`, missingFields);
    }

    console.log(`   ✅ Success`);
    console.log(`   Data sample:`, JSON.stringify(data.data, null, 2).substring(0, 200) + '...');
    return true;

  } catch (error) {
    console.log(`   ❌ Error:`, error instanceof Error ? error.message : error);
    return false;
  }
}

// ============================================================================
// Main Test Function
// ============================================================================

async function runTests() {
  console.log('🧪 Phase 1 Endpoint Tests\n');
  console.log('='.repeat(60));

  // Find the server
  console.log('\n🔍 Looking for running server...');
  try {
    BASE_URL = await findServerUrl();
  } catch (error) {
    console.error('\n❌', error instanceof Error ? error.message : error);
    console.error('\nMake sure the dev server is running before running tests.');
    process.exit(1);
  }

  // Connect to MongoDB to get test data
  console.log('\n📡 Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI!);
  console.log('✅ Connected\n');

  // Get a sample device ID
  const sampleDevice = await DeviceV2.findOne().lean();
  if (!sampleDevice) {
    console.log('❌ No devices found. Run seed-v2 script first.');
    process.exit(1);
  }

  const deviceId = sampleDevice._id;
  console.log(`📱 Using test device: ${deviceId}\n`);

  const results: Record<string, boolean> = {};

  // Test 1: Maintenance Forecast (default params)
  results['Maintenance Forecast - Default'] = await testEndpoint(
    'Maintenance Forecast - Default',
    '/api/v2/analytics/maintenance-forecast',
    ['critical', 'warning', 'watch', 'summary.total_at_risk', 'summary.critical_count']
  );

  // Test 2: Maintenance Forecast (with filters)
  results['Maintenance Forecast - Filtered'] = await testEndpoint(
    'Maintenance Forecast - Filtered',
    `/api/v2/analytics/maintenance-forecast?days_ahead=14&severity_threshold=critical`,
    ['critical', 'summary', 'filters_applied.days_ahead']
  );

  // Test 3: Temperature Correlation
  results['Temperature Correlation'] = await testEndpoint(
    'Temperature Correlation',
    `/api/v2/analytics/temperature-correlation?device_id=${deviceId}`,
    [
      'device_id',
      'device_temp_series',
      'ambient_temp_series',
      'correlation_score',
      'diagnosis',
      'diagnosis_explanation'
    ]
  );

  // Test 4: Health Analytics (with predictive_maintenance)
  results['Health Analytics - Extended'] = await testEndpoint(
    'Health Analytics - Extended',
    '/api/v2/analytics/health',
    [
      'summary.health_score',
      'alerts.predictive_maintenance',
      'alerts.predictive_maintenance.count'
    ]
  );

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary\n');

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([name, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
  });

  console.log(`\n${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n🎉 All Phase 1 endpoints working correctly!');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above.');
  }

  // Disconnect
  await mongoose.disconnect();
  console.log('\n📡 Disconnected from MongoDB');
}

// ============================================================================
// Run Tests
// ============================================================================

runTests().catch((error) => {
  console.error('\n💥 Test script failed:', error);
  process.exit(1);
});
