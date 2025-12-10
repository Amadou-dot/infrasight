# V2 Validation Schemas

This directory contains comprehensive Zod validation schemas for the V2 API endpoints.

## Overview

The validation schemas are organized into three main files:

- **`common.validation.ts`** - Shared validation utilities used across the API
- **`v2/device.validation.ts`** - Device-specific validation schemas
- **`v2/reading.validation.ts`** - Reading-specific validation schemas

## Usage

### Importing Schemas

```typescript
// Import all V2 schemas
import { createDeviceSchema, createReadingSchema } from '@/lib/validations/v2';

// Or import specific schemas
import { createDeviceSchema } from '@/lib/validations/v2/device.validation';
import { createReadingSchema } from '@/lib/validations/v2/reading.validation';
```

### Using in API Routes

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createDeviceSchema } from '@/lib/validations/v2';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request body
    const validatedData = createDeviceSchema.parse(body);
    
    // Use validated data...
    // ...
    
    return NextResponse.json(validatedData, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }
    // Handle other errors...
  }
}
```

### Using with Query Parameters

```typescript
import { deviceQuerySchema } from '@/lib/validations/v2';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const params = Object.fromEntries(searchParams);
  
  try {
    // Validate and parse query parameters
    const validatedParams = deviceQuerySchema.parse(params);
    
    // Use validated params...
    // ...
  } catch (error) {
    // Handle validation error...
  }
}
```

## Common Validation Schemas

### Pagination

```typescript
// Cursor-based pagination
cursorPaginationSchema
// Fields: cursor (optional), limit (1-100, default: 20)

// Offset-based pagination
offsetPaginationSchema
// Fields: offset (default: 0), limit (1-100, default: 20)
```

### Date Ranges

```typescript
dateRangeSchema
// Fields: start_date, end_date
// Validates that start_date <= end_date
```

### Sort Orders

```typescript
sortOrderSchema // 'asc' | 'desc'
sortSchema // Fields: sort_by, sort_order
```

## Device Validation Schemas

### Device Status

```typescript
deviceStatusSchema
// Values: 'active' | 'maintenance' | 'offline' | 'decommissioned' | 'error'
```

### Create Device

```typescript
createDeviceSchema
```

**Required fields:**
- `serial_number`: string (non-empty, unique)
- `manufacturer`: string (non-empty)
- `model`: string (non-empty)
- `firmware_version`: string (non-empty)
- `configuration.threshold_warning`: number (positive, < threshold_critical)
- `configuration.threshold_critical`: number (positive, > threshold_warning)

**Optional fields:**
- `status`: device status enum (default: 'active')
- `health.battery_level`: number (0-100)
- `health.signal_strength`: number (non-negative)

### Update Device

```typescript
updateDeviceSchema
```

All fields are optional, but at least one must be provided. Same validation rules as create.

### Query Devices

```typescript
deviceQuerySchema
```

**Query parameters:**
- `serial_number`: string (optional)
- `manufacturer`: string (optional)
- `model`: string (optional)
- `status`: device status enum (optional)
- `min_battery_level`: number 0-100 (optional)
- `max_battery_level`: number 0-100 (optional, must be >= min_battery_level)
- Includes pagination and sort fields

## Reading Validation Schemas

### Create Reading

```typescript
createReadingSchema
```

**Required fields:**
- `device_id`: string (non-empty)
- `value`: number (finite, can be negative for temperatures)
- `timestamp`: Date (cannot be in the future)

**Optional fields:**
- `metadata`: object with string keys (optional)

### Bulk Insert Readings

```typescript
bulkInsertReadingsSchema
```

**Fields:**
- `readings`: array of reading objects (1-1000 items)

### Query Readings

```typescript
readingQuerySchema
```

**Query parameters:**
- `device_id`: string (optional, exclusive with device_ids)
- `device_ids`: comma-separated string (optional, exclusive with device_id)
- `min_value`: number (optional)
- `max_value`: number (optional, must be >= min_value)
- `start_date`: Date (optional)
- `end_date`: Date (optional, must be >= start_date)
- Includes cursor pagination and sort fields

### Latest Readings Query

```typescript
latestReadingsQuerySchema
```

Get the latest reading for specific device(s).

### Aggregate Readings Query

```typescript
aggregateReadingsQuerySchema
```

Get aggregated data (avg, min, max, sum, count) for a device over a time period.

## Validation Rules

### Edge Cases Handled

✅ **Negative numbers**: Allowed for reading values (e.g., temperatures)  
✅ **Battery level**: Must be 0-100  
✅ **Threshold validation**: warning < critical  
✅ **Future timestamps**: Not allowed  
✅ **Date ranges**: start_date <= end_date  
✅ **Value ranges**: min_value <= max_value  
✅ **Empty updates**: Rejected (at least one field required)  
✅ **Bulk limits**: 1-1000 readings per request  

### Error Messages

All validation errors include:
- Clear, actionable error messages
- Field paths showing exactly where the error occurred
- Type information for debugging

Example error response:
```json
{
  "error": "Validation failed",
  "details": [
    {
      "code": "custom",
      "path": ["configuration", "threshold_warning"],
      "message": "threshold_warning must be less than threshold_critical"
    }
  ]
}
```

## TypeScript Types

All schemas export their inferred TypeScript types:

```typescript
import type { 
  CreateDevice, 
  UpdateDevice, 
  DeviceQuery,
  CreateReading,
  ReadingQuery 
} from '@/lib/validations/v2';
```

## Testing

The schemas have been validated against comprehensive test cases including:
- Valid data scenarios
- Edge cases (negative numbers, boundary values)
- Invalid data (out-of-range values, future timestamps)
- Complex validations (threshold comparisons, date ranges)

See `/tmp/test-validations.ts` for examples.
