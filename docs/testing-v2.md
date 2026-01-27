# Infrasight V2 Testing Guide

Comprehensive testing strategy and implementation guide for the Infrasight V2 IoT monitoring system.

## Table of Contents

- [Overview](#overview)
- [Testing Pyramid](#testing-pyramid)
- [Testing Tools](#testing-tools)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [Unit Tests](#unit-tests)
  - [Model Tests](#model-tests)
  - [Validation Schema Tests](#validation-schema-tests)
  - [Utility Tests](#utility-tests)
- [Integration Tests](#integration-tests)
  - [API Route Tests](#api-route-tests)
  - [Database Tests](#database-tests)
- [End-to-End Tests](#end-to-end-tests)
  - [User Flow Tests](#user-flow-tests)
  - [Real-time Tests](#real-time-tests)
- [Test Utilities](#test-utilities)
- [Mocking Strategies](#mocking-strategies)
- [Coverage Goals](#coverage-goals)
- [CI/CD Integration](#cicd-integration)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

Infrasight uses a comprehensive testing strategy following the test pyramid model:

- **Unit Tests**: Fast, isolated tests for individual functions and modules
- **Integration Tests**: Tests for API routes with database and external services
- **End-to-End Tests**: Full user journey tests in a browser environment

### Testing Goals

| Category           | Coverage Target | Priority |
| ------------------ | --------------- | -------- |
| API Routes         | >= 85%          | Critical |
| Models             | >= 90%          | Critical |
| Validation Schemas | 100%            | Critical |
| Utilities          | >= 80%          | High     |
| Components         | >= 70%          | Medium   |
| E2E (User Flows)   | Critical paths  | High     |

---

## Testing Pyramid

```
                    /\
                   /  \
                  /    \        <- 10% - Slow, Critical Paths
                 / E2E  \
                /--------\
               / Integr.  \      <- 30% - API + Database
              /            \
             /--------------\
            /     Unit       \   <- 60% - Fast, Isolated
           /                  \
          /--------------------\
```

---

## Testing Tools

| Tool                      | Purpose                    | Usage                |
| ------------------------- | -------------------------- | -------------------- |
| **Jest**                  | Unit & Integration testing | Primary test runner  |
| **Testing Library**       | React component testing    | Component assertions |
| **Playwright**            | E2E testing                | Browser automation   |
| **MongoDB Memory Server** | In-memory MongoDB          | Database isolation   |
| **Supertest**             | HTTP testing               | API route testing    |

---

## Project Structure

```
infrasight/
├── __tests__/
│   ├── unit/
│   │   ├── models/
│   │   │   ├── DeviceV2.test.ts
│   │   │   └── ReadingV2.test.ts
│   │   ├── validations/
│   │   │   ├── device.validation.test.ts
│   │   │   └── reading.validation.test.ts
│   │   └── utils/
│   │       ├── errorHandler.test.ts
│   │       └── v2-client.test.ts
│   ├── integration/
│   │   └── api/
│   │       ├── devices.integration.test.ts
│   │       ├── readings.integration.test.ts
│   │       └── analytics.integration.test.ts
│   └── setup/
│       ├── jest.setup.ts
│       ├── mongodb.setup.ts
│       └── mocks/
│           ├── pusher.mock.ts
│           └── next-request.mock.ts
├── e2e/
│   ├── dashboard.spec.ts
│   ├── device-detail.spec.ts
│   └── real-time.spec.ts
├── jest.config.js
├── jest.setup.js
└── playwright.config.ts
```

---

## Setup

### Install Dependencies

```bash
# Testing frameworks
pnpm add -D jest @types/jest ts-jest
pnpm add -D @testing-library/react @testing-library/jest-dom
pnpm add -D @testing-library/user-event

# Database mocking
pnpm add -D mongodb-memory-server

# API testing
pnpm add -D supertest @types/supertest

# E2E testing
pnpm add -D @playwright/test
```

### Jest Configuration

Create `jest.config.js`:

```javascript
/** @type {import('jest').Config} */
const config = {
  // Use ts-jest for TypeScript
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Module path aliases (match tsconfig.json)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Test patterns
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/e2e/', // E2E tests use Playwright
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'app/api/**/*.ts',
    'lib/**/*.ts',
    'models/**/*.ts',
    'components/**/*.tsx',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Timeout for async tests
  testTimeout: 30000,

  // Clear mocks between tests
  clearMocks: true,
};

module.exports = config;
```

### Jest Setup File

Create `jest.setup.js`:

```javascript
// Extend expect with jest-dom matchers
import '@testing-library/jest-dom';

// Global test utilities
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongoServer;

// Setup MongoDB Memory Server before all tests
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

// Clear all collections between tests
afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// Cleanup after all tests
afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// Mock Pusher
jest.mock('@/lib/pusher-server', () => ({
  getPusherServer: jest.fn(() => ({
    trigger: jest.fn().mockResolvedValue({}),
  })),
}));

// Mock environment variables
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.PUSHER_APP_ID = 'test';
process.env.PUSHER_KEY = 'test';
process.env.PUSHER_SECRET = 'test';
process.env.PUSHER_CLUSTER = 'test';
```

### Playwright Configuration

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Package.json Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:unit": "jest --testPathPattern=__tests__/unit",
    "test:integration": "jest --testPathPattern=__tests__/integration",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

---

## Unit Tests

### Model Tests

**File**: `__tests__/unit/models/DeviceV2.test.ts`

```typescript
import mongoose from 'mongoose';
import DeviceV2, { type IDeviceV2 } from '@/models/v2/DeviceV2';

describe('DeviceV2 Model', () => {
  // Test data factory
  const createValidDevice = (overrides: Partial<IDeviceV2> = {}): Partial<IDeviceV2> => ({
    _id: 'device_test_001',
    serial_number: 'SN-TEST-001',
    manufacturer: 'TestCorp',
    device_model: 'TestSensor',
    firmware_version: '1.0.0',
    type: 'temperature',
    configuration: {
      threshold_warning: 25,
      threshold_critical: 30,
      sampling_interval: 60,
      calibration_date: null,
      calibration_offset: 0,
    },
    location: {
      building_id: 'test-building',
      floor: 1,
      room_name: 'Test Room',
    },
    ...overrides,
  });

  describe('Creation', () => {
    it('should create a device with valid data', async () => {
      const deviceData = createValidDevice();
      const device = await DeviceV2.create(deviceData);

      expect(device._id).toBe('device_test_001');
      expect(device.serial_number).toBe('SN-TEST-001');
      expect(device.status).toBe('active');
      expect(device.health.uptime_percentage).toBe(100);
      expect(device.audit.created_at).toBeInstanceOf(Date);
    });

    it('should reject device without required fields', async () => {
      const deviceData = { _id: 'device_test' };

      await expect(DeviceV2.create(deviceData)).rejects.toThrow();
    });

    it('should reject duplicate serial number', async () => {
      await DeviceV2.create(createValidDevice());

      const duplicateData = createValidDevice({
        _id: 'device_test_002',
      });

      await expect(DeviceV2.create(duplicateData)).rejects.toThrow(/duplicate/i);
    });

    it('should reject invalid device type', async () => {
      const deviceData = createValidDevice({
        type: 'invalid_type' as any,
      });

      await expect(DeviceV2.create(deviceData)).rejects.toThrow();
    });
  });

  describe('Static Methods', () => {
    beforeEach(async () => {
      await DeviceV2.create(createValidDevice());
      await DeviceV2.create(
        createValidDevice({
          _id: 'device_test_002',
          serial_number: 'SN-TEST-002',
        })
      );
    });

    describe('findActive', () => {
      it('should return only non-deleted devices', async () => {
        await DeviceV2.softDelete('device_test_001');

        const devices = await DeviceV2.findActive();

        expect(devices).toHaveLength(1);
        expect(devices[0]._id).toBe('device_test_002');
      });

      it('should support filters', async () => {
        await DeviceV2.findByIdAndUpdate('device_test_002', { status: 'offline' });

        const devices = await DeviceV2.findActive({ status: 'active' });

        expect(devices).toHaveLength(1);
        expect(devices[0]._id).toBe('device_test_001');
      });
    });

    describe('softDelete', () => {
      it('should soft delete a device', async () => {
        const result = await DeviceV2.softDelete('device_test_001', 'test-user');

        expect(result).not.toBeNull();
        expect(result?.status).toBe('decommissioned');
        expect(result?.audit.deleted_at).toBeInstanceOf(Date);
        expect(result?.audit.deleted_by).toBe('test-user');
      });

      it('should return null for non-existent device', async () => {
        const result = await DeviceV2.softDelete('non_existent');

        expect(result).toBeNull();
      });
    });

    describe('restore', () => {
      it('should restore a soft-deleted device', async () => {
        await DeviceV2.softDelete('device_test_001');
        const result = await DeviceV2.restore('device_test_001');

        expect(result).not.toBeNull();
        expect(result?.status).toBe('offline');
        expect(result?.audit.deleted_at).toBeUndefined();
      });
    });
  });

  describe('Middleware', () => {
    it('should update audit.updated_at on save', async () => {
      const device = await DeviceV2.create(createValidDevice());
      const originalUpdatedAt = device.audit.updated_at;

      // Wait a bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      device.status = 'maintenance';
      await device.save();

      expect(device.audit.updated_at.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });
});
```

**File**: `__tests__/unit/models/ReadingV2.test.ts`

```typescript
import ReadingV2, { type IReadingV2 } from '@/models/v2/ReadingV2';

describe('ReadingV2 Model', () => {
  const createValidReading = (overrides: Partial<IReadingV2> = {}) => ({
    metadata: {
      device_id: 'device_001',
      type: 'temperature',
      unit: 'celsius',
      source: 'sensor',
    },
    timestamp: new Date(),
    value: 22.5,
    quality: {
      is_valid: true,
      is_anomaly: false,
    },
    ...overrides,
  });

  describe('Creation', () => {
    it('should create a reading with valid data', async () => {
      const readingData = createValidReading();
      const reading = await ReadingV2.create(readingData);

      expect(reading.value).toBe(22.5);
      expect(reading.metadata.device_id).toBe('device_001');
      expect(reading.quality.is_valid).toBe(true);
    });

    it('should reject reading without required fields', async () => {
      await expect(ReadingV2.create({ value: 22 })).rejects.toThrow();
    });
  });

  describe('Static Methods', () => {
    beforeEach(async () => {
      // Create test readings with different timestamps
      const now = new Date();

      await ReadingV2.create(
        createValidReading({
          timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
          value: 20,
        })
      );
      await ReadingV2.create(
        createValidReading({
          timestamp: new Date(now.getTime() - 1800000), // 30 min ago
          value: 21,
        })
      );
      await ReadingV2.create(
        createValidReading({
          timestamp: now,
          value: 22,
        })
      );
    });

    describe('getLatestForDevice', () => {
      it('should return the most recent reading', async () => {
        const latest = await ReadingV2.getLatestForDevice('device_001');

        expect(latest).not.toBeNull();
        expect(latest?.value).toBe(22);
      });

      it('should filter by type', async () => {
        await ReadingV2.create(
          createValidReading({
            metadata: {
              device_id: 'device_001',
              type: 'humidity',
              unit: 'percent',
              source: 'sensor',
            },
            value: 45,
          })
        );

        const latest = await ReadingV2.getLatestForDevice('device_001', 'humidity');

        expect(latest?.value).toBe(45);
      });
    });

    describe('getForDeviceInRange', () => {
      it('should return readings in time range', async () => {
        const now = new Date();
        const readings = await ReadingV2.getForDeviceInRange(
          'device_001',
          new Date(now.getTime() - 2700000), // 45 min ago
          now
        );

        expect(readings).toHaveLength(2);
      });

      it('should respect limit option', async () => {
        const now = new Date();
        const readings = await ReadingV2.getForDeviceInRange(
          'device_001',
          new Date(now.getTime() - 7200000),
          now,
          { limit: 1 }
        );

        expect(readings).toHaveLength(1);
      });
    });

    describe('getAnomalies', () => {
      it('should return anomalous readings', async () => {
        await ReadingV2.create(
          createValidReading({
            value: 99,
            quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.9 },
          })
        );

        const anomalies = await ReadingV2.getAnomalies();

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0].value).toBe(99);
      });

      it('should filter by minimum score', async () => {
        await ReadingV2.create(
          createValidReading({
            value: 98,
            quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.5 },
          })
        );
        await ReadingV2.create(
          createValidReading({
            value: 99,
            quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.9 },
          })
        );

        const anomalies = await ReadingV2.getAnomalies(undefined, { minScore: 0.8 });

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0].value).toBe(99);
      });
    });
  });
});
```

### Validation Schema Tests

**File**: `__tests__/unit/validations/device.validation.test.ts`

```typescript
import {
  createDeviceSchema,
  updateDeviceSchema,
  listDevicesQuerySchema,
  deviceStatusSchema,
  deviceTypeSchema,
} from '@/lib/validations/v2/device.validation';

describe('Device Validation Schemas', () => {
  describe('deviceStatusSchema', () => {
    it('should accept valid statuses', () => {
      const validStatuses = ['active', 'maintenance', 'offline', 'decommissioned', 'error'];

      validStatuses.forEach(status => {
        expect(() => deviceStatusSchema.parse(status)).not.toThrow();
      });
    });

    it('should reject invalid status', () => {
      expect(() => deviceStatusSchema.parse('invalid')).toThrow();
    });
  });

  describe('deviceTypeSchema', () => {
    it('should accept valid device types', () => {
      const validTypes = ['temperature', 'humidity', 'occupancy', 'power', 'co2'];

      validTypes.forEach(type => {
        expect(() => deviceTypeSchema.parse(type)).not.toThrow();
      });
    });

    it('should reject invalid device type', () => {
      expect(() => deviceTypeSchema.parse('invalid_type')).toThrow();
    });
  });

  describe('createDeviceSchema', () => {
    const validDeviceData = {
      _id: 'device_001',
      serial_number: 'SN-001',
      manufacturer: 'TestCorp',
      device_model: 'TestSensor',
      firmware_version: '1.0.0',
      type: 'temperature',
      configuration: {
        threshold_warning: 25,
        threshold_critical: 30,
      },
      location: {
        building_id: 'building-1',
        floor: 1,
        room_name: 'Room 101',
      },
    };

    it('should accept valid device data', () => {
      const result = createDeviceSchema.safeParse(validDeviceData);

      expect(result.success).toBe(true);
    });

    it('should set default values', () => {
      const result = createDeviceSchema.parse(validDeviceData);

      expect(result.status).toBe('active');
      expect(result.metadata?.department).toBe('unknown');
      expect(result.compliance?.retention_days).toBe(90);
    });

    it('should reject missing required fields', () => {
      const invalidData = { _id: 'device_001' };
      const result = createDeviceSchema.safeParse(invalidData);

      expect(result.success).toBe(false);
    });

    it('should validate serial number format', () => {
      const invalidData = { ...validDeviceData, serial_number: '' };
      const result = createDeviceSchema.safeParse(invalidData);

      expect(result.success).toBe(false);
    });

    it('should validate floor is a number', () => {
      const dataWithStringFloor = {
        ...validDeviceData,
        location: { ...validDeviceData.location, floor: 'first' },
      };
      const result = createDeviceSchema.safeParse(dataWithStringFloor);

      expect(result.success).toBe(false);
    });
  });

  describe('updateDeviceSchema', () => {
    it('should allow partial updates', () => {
      const result = updateDeviceSchema.safeParse({ status: 'maintenance' });

      expect(result.success).toBe(true);
    });

    it('should reject empty update', () => {
      const result = updateDeviceSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('should validate partial configuration updates', () => {
      const result = updateDeviceSchema.safeParse({
        configuration: { threshold_warning: 26 },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('listDevicesQuerySchema', () => {
    it('should accept valid query parameters', () => {
      const query = {
        page: 1,
        limit: 20,
        status: 'active',
        floor: 1,
      };
      const result = listDevicesQuerySchema.safeParse(query);

      expect(result.success).toBe(true);
    });

    it('should set default values', () => {
      const result = listDevicesQuerySchema.parse({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.include_deleted).toBe(false);
      expect(result.offline_threshold_minutes).toBe(5);
    });

    it('should parse comma-separated status values', () => {
      const result = listDevicesQuerySchema.parse({ status: 'active,offline' });

      expect(result.status).toEqual(['active', 'offline']);
    });

    it('should reject invalid page number', () => {
      const result = listDevicesQuerySchema.safeParse({ page: 0 });

      expect(result.success).toBe(false);
    });

    it('should reject limit exceeding max', () => {
      const result = listDevicesQuerySchema.safeParse({ limit: 500 });

      expect(result.success).toBe(false);
    });

    it('should reject conflicting deleted filters', () => {
      const result = listDevicesQuerySchema.safeParse({
        include_deleted: true,
        only_deleted: true,
      });

      expect(result.success).toBe(false);
    });
  });
});
```

### Utility Tests

**File**: `__tests__/unit/utils/errorHandler.test.ts`

```typescript
import { ZodError, z } from 'zod';
import { handleError, normalizeError, withErrorHandler } from '@/lib/errors/errorHandler';
import { ApiError } from '@/lib/errors/ApiError';
import { ErrorCodes } from '@/lib/errors/errorCodes';

describe('Error Handler', () => {
  describe('handleError', () => {
    it('should pass through ApiError unchanged', () => {
      const apiError = new ApiError(ErrorCodes.DEVICE_NOT_FOUND, 404, 'Device not found');

      const { error, shouldLog } = handleError(apiError);

      expect(error.errorCode).toBe(ErrorCodes.DEVICE_NOT_FOUND);
      expect(error.statusCode).toBe(404);
      expect(shouldLog).toBe(false); // 4xx errors don't log by default
    });

    it('should convert ZodError to validation error', () => {
      const schema = z.object({ name: z.string() });
      let zodError: ZodError | undefined;

      try {
        schema.parse({ name: 123 });
      } catch (e) {
        zodError = e as ZodError;
      }

      const { error } = handleError(zodError);

      expect(error.errorCode).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.statusCode).toBe(400);
    });

    it('should handle MongoDB duplicate key error', () => {
      const mongoError = new Error('Duplicate key');
      (mongoError as any).code = 11000;
      (mongoError as any).keyPattern = { serial_number: 1 };
      (mongoError as any).keyValue = { serial_number: 'SN-001' };

      const { error } = handleError(mongoError);

      expect(error.errorCode).toBe(ErrorCodes.SERIAL_NUMBER_EXISTS);
      expect(error.statusCode).toBe(409);
    });

    it('should handle connection errors', () => {
      const connError = new Error('ECONNREFUSED');
      (connError as any).code = 'ECONNREFUSED';

      const { error, shouldLog } = handleError(connError);

      expect(error.errorCode).toBe(ErrorCodes.CONNECTION_ERROR);
      expect(error.statusCode).toBe(500);
      expect(shouldLog).toBe(true);
    });

    it('should handle unknown errors', () => {
      const { error } = handleError('Something went wrong');

      expect(error.errorCode).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.statusCode).toBe(500);
    });
  });

  describe('normalizeError', () => {
    it('should return ApiError directly', () => {
      const error = normalizeError(new Error('Test'));

      expect(error).toBeInstanceOf(ApiError);
    });
  });

  describe('withErrorHandler', () => {
    it('should pass through successful response', async () => {
      const handler = async () => Response.json({ success: true });
      const wrapped = withErrorHandler(handler);

      const response = await wrapped();
      const data = await response.json();

      expect(data.success).toBe(true);
    });

    it('should catch and format errors', async () => {
      const handler = async () => {
        throw new ApiError(ErrorCodes.DEVICE_NOT_FOUND, 404, 'Not found');
      };
      const wrapped = withErrorHandler(handler);

      const response = await wrapped();
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe(ErrorCodes.DEVICE_NOT_FOUND);
    });
  });
});
```

---

## Integration Tests

### API Route Tests

**File**: `__tests__/integration/api/devices.integration.test.ts`

```typescript
import { createMocks } from 'node-mocks-http';
import { GET, POST } from '@/app/api/v2/devices/route';
import DeviceV2 from '@/models/v2/DeviceV2';
import dbConnect from '@/lib/db';

describe('GET /api/v2/devices', () => {
  beforeEach(async () => {
    await dbConnect();

    // Seed test data
    await DeviceV2.create([
      {
        _id: 'device_001',
        serial_number: 'SN-001',
        manufacturer: 'TestCorp',
        device_model: 'Sensor',
        firmware_version: '1.0',
        type: 'temperature',
        status: 'active',
        configuration: {
          threshold_warning: 25,
          threshold_critical: 30,
        },
        location: {
          building_id: 'building-1',
          floor: 1,
          room_name: 'Room 101',
        },
      },
      {
        _id: 'device_002',
        serial_number: 'SN-002',
        manufacturer: 'TestCorp',
        device_model: 'Sensor',
        firmware_version: '1.0',
        type: 'humidity',
        status: 'offline',
        configuration: {
          threshold_warning: 60,
          threshold_critical: 80,
        },
        location: {
          building_id: 'building-1',
          floor: 2,
          room_name: 'Room 201',
        },
      },
    ]);
  });

  it('should return paginated devices', async () => {
    const request = new Request('http://localhost/api/v2/devices?limit=10');

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(2);
    expect(data.pagination.total).toBe(2);
  });

  it('should filter by status', async () => {
    const request = new Request('http://localhost/api/v2/devices?status=active');

    const response = await GET(request as any);
    const data = await response.json();

    expect(data.data).toHaveLength(1);
    expect(data.data[0]._id).toBe('device_001');
  });

  it('should filter by floor', async () => {
    const request = new Request('http://localhost/api/v2/devices?floor=2');

    const response = await GET(request as any);
    const data = await response.json();

    expect(data.data).toHaveLength(1);
    expect(data.data[0]._id).toBe('device_002');
  });

  it('should sort by field', async () => {
    const request = new Request(
      'http://localhost/api/v2/devices?sortBy=serial_number&sortDirection=desc'
    );

    const response = await GET(request as any);
    const data = await response.json();

    expect(data.data[0].serial_number).toBe('SN-002');
    expect(data.data[1].serial_number).toBe('SN-001');
  });

  it('should exclude soft-deleted devices by default', async () => {
    await DeviceV2.softDelete('device_001');

    const request = new Request('http://localhost/api/v2/devices');
    const response = await GET(request as any);
    const data = await response.json();

    expect(data.data).toHaveLength(1);
    expect(data.data[0]._id).toBe('device_002');
  });

  it('should handle validation errors', async () => {
    const request = new Request('http://localhost/api/v2/devices?page=0');

    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v2/devices', () => {
  const validDevice = {
    _id: 'device_new',
    serial_number: 'SN-NEW',
    manufacturer: 'TestCorp',
    device_model: 'Sensor',
    firmware_version: '1.0',
    type: 'temperature',
    configuration: {
      threshold_warning: 25,
      threshold_critical: 30,
    },
    location: {
      building_id: 'building-1',
      floor: 1,
      room_name: 'Room 101',
    },
  };

  it('should create a new device', async () => {
    const request = new Request('http://localhost/api/v2/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDevice),
    });

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data._id).toBe('device_new');

    // Verify in database
    const device = await DeviceV2.findById('device_new');
    expect(device).not.toBeNull();
  });

  it('should reject duplicate serial number', async () => {
    await DeviceV2.create({ ...validDevice, _id: 'existing' });

    const request = new Request('http://localhost/api/v2/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validDevice, _id: 'device_new' }),
    });

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error.code).toBe('SERIAL_NUMBER_EXISTS');
  });

  it('should reject invalid input', async () => {
    const request = new Request('http://localhost/api/v2/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: 'device_new' }),
    });

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });
});
```

---

## End-to-End Tests

### User Flow Tests

**File**: `e2e/dashboard.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display device grid', async ({ page }) => {
    // Wait for devices to load
    await expect(page.locator('[data-testid="device-grid"]')).toBeVisible();

    // Should show device cards
    const deviceCards = page.locator('[data-testid="device-card"]');
    await expect(deviceCards.first()).toBeVisible();
  });

  test('should filter devices by status', async ({ page }) => {
    // Click status filter
    await page.click('[data-testid="status-filter"]');
    await page.click('text=Active');

    // Verify only active devices shown
    const deviceCards = page.locator('[data-testid="device-card"]');
    for (const card of await deviceCards.all()) {
      await expect(card.locator('[data-testid="device-status"]')).toHaveText('Active');
    }
  });

  test('should open device detail modal on click', async ({ page }) => {
    // Click first device
    await page.locator('[data-testid="device-card"]').first().click();

    // Modal should appear
    await expect(page.locator('[data-testid="device-modal"]')).toBeVisible();

    // Should show device info
    await expect(page.locator('[data-testid="device-serial"]')).toBeVisible();
  });

  test('should show health metrics', async ({ page }) => {
    // Navigate to health section
    await page.click('[data-testid="nav-health"]');

    // Should show health summary
    await expect(page.locator('[data-testid="health-score"]')).toBeVisible();
    await expect(page.locator('[data-testid="device-count"]')).toBeVisible();
  });
});
```

**File**: `e2e/device-detail.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Device Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Open first device
    await page.locator('[data-testid="device-card"]').first().click();
    await expect(page.locator('[data-testid="device-modal"]')).toBeVisible();
  });

  test('should display device information', async ({ page }) => {
    await expect(page.locator('[data-testid="device-serial"]')).toBeVisible();
    await expect(page.locator('[data-testid="device-type"]')).toBeVisible();
    await expect(page.locator('[data-testid="device-location"]')).toBeVisible();
  });

  test('should display health metrics', async ({ page }) => {
    await expect(page.locator('[data-testid="uptime-percentage"]')).toBeVisible();
    await expect(page.locator('[data-testid="last-seen"]')).toBeVisible();
  });

  test('should show reading history chart', async ({ page }) => {
    await expect(page.locator('[data-testid="reading-chart"]')).toBeVisible();
  });

  test('should close modal on escape', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="device-modal"]')).not.toBeVisible();
  });
});
```

---

## Test Utilities

### Test Factories

**File**: `__tests__/setup/factories.ts`

```typescript
import { type IDeviceV2 } from '@/models/v2/DeviceV2';
import { type IReadingV2 } from '@/models/v2/ReadingV2';

let deviceCounter = 0;
let readingCounter = 0;

export function createDeviceData(overrides: Partial<IDeviceV2> = {}): Partial<IDeviceV2> {
  deviceCounter++;
  return {
    _id: `device_test_${deviceCounter}`,
    serial_number: `SN-TEST-${deviceCounter}`,
    manufacturer: 'TestCorp',
    device_model: 'TestSensor',
    firmware_version: '1.0.0',
    type: 'temperature',
    status: 'active',
    configuration: {
      threshold_warning: 25,
      threshold_critical: 30,
      sampling_interval: 60,
      calibration_date: null,
      calibration_offset: 0,
    },
    location: {
      building_id: 'test-building',
      floor: 1,
      room_name: `Test Room ${deviceCounter}`,
    },
    metadata: {
      tags: [],
      department: 'test',
    },
    ...overrides,
  };
}

export function createReadingData(overrides: Partial<IReadingV2> = {}): Partial<IReadingV2> {
  readingCounter++;
  return {
    metadata: {
      device_id: 'device_test_1',
      type: 'temperature',
      unit: 'celsius',
      source: 'sensor',
    },
    timestamp: new Date(),
    value: 22.5 + Math.random() * 5,
    quality: {
      is_valid: true,
      is_anomaly: false,
    },
    ...overrides,
  };
}

export function resetCounters() {
  deviceCounter = 0;
  readingCounter = 0;
}
```

### Mock Next.js Request

**File**: `__tests__/setup/mocks/next-request.mock.ts`

```typescript
import { NextRequest } from 'next/server';

export function createMockRequest(
  url: string,
  options: {
    method?: string;
    body?: object;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const { method = 'GET', body, headers = {} } = options;

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  return new NextRequest(new URL(url, 'http://localhost'), init);
}
```

---

## Mocking Strategies

### Database Mocking

Use MongoDB Memory Server for isolated database tests:

```typescript
// Already configured in jest.setup.js
// Each test gets a fresh database
```

### Pusher Mocking

```typescript
jest.mock('@/lib/pusher-server', () => ({
  getPusherServer: jest.fn(() => ({
    trigger: jest.fn().mockResolvedValue({}),
  })),
}));

// In tests
import { getPusherServer } from '@/lib/pusher-server';

it('should broadcast reading', async () => {
  const pusher = getPusherServer();

  // ... perform action that triggers Pusher

  expect(pusher.trigger).toHaveBeenCalledWith('sensor-readings', 'new-reading', expect.any(Object));
});
```

### API Client Mocking

```typescript
jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    devices: {
      list: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    readings: {
      list: jest.fn(),
      latest: jest.fn(),
    },
    analytics: {
      health: jest.fn(),
    },
  },
}));
```

---

## Coverage Goals

| Category           | Coverage Target | Current | Status  |
| ------------------ | --------------- | ------- | ------- |
| API Routes         | >= 85%          | -       | Pending |
| Models             | >= 90%          | -       | Pending |
| Validation Schemas | 100%            | -       | Pending |
| Utilities          | >= 80%          | -       | Pending |
| Components         | >= 70%          | -       | Pending |

Run coverage report:

```bash
pnpm test:coverage
```

---

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Install dependencies
        run: pnpm install

      - name: Run unit tests
        run: pnpm test:unit

      - name: Run integration tests
        run: pnpm test:integration

      - name: Run coverage
        run: pnpm test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  e2e:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install pnpm
        uses: pnpm/action-setup@v2

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright
        run: pnpm exec playwright install --with-deps

      - name: Run E2E tests
        run: pnpm test:e2e

      - name: Upload Playwright report
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

---

## Best Practices

### Test Organization

1. **One file per module**: Match test file structure to source structure
2. **Descriptive test names**: Use `should [expected behavior] when [condition]`
3. **Arrange-Act-Assert**: Structure tests clearly
4. **Use factories**: Create reusable test data generators

### Test Performance

1. **Use beforeEach for setup**: Clear database between tests
2. **Parallelize tests**: Jest runs test files in parallel
3. **Minimize database operations**: Use factories and bulk inserts
4. **Mock external services**: Don't call real APIs in tests

### Test Reliability

1. **Avoid time-dependent tests**: Mock Date.now() when needed
2. **Wait for async operations**: Use proper async/await
3. **Clear state between tests**: Reset mocks and database
4. **Use deterministic data**: Avoid random data in assertions

---

## Troubleshooting

### Tests Timeout

```javascript
// Increase timeout for slow tests
jest.setTimeout(30000);

// Or per-test
it('slow test', async () => {
  // ...
}, 30000);
```

### Database Connection Issues

```javascript
// Ensure proper cleanup
afterAll(async () => {
  await mongoose.disconnect();
});
```

### Flaky E2E Tests

```typescript
// Wait for elements properly
await page.waitForSelector('[data-testid="element"]');
await expect(page.locator('[data-testid="element"]')).toBeVisible();

// Use auto-waiting assertions
await expect(page.locator('text=Loading')).not.toBeVisible();
```

---

_Last Updated: 2026-01-05_
