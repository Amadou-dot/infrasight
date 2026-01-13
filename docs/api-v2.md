# Infrasight V2 API Documentation

Complete API reference for the Infrasight V2 IoT sensor monitoring system.

## Table of Contents

- [Overview](#overview)
- [Base URL](#base-url)
- [Authentication](#authentication)
- [Common Response Format](#common-response-format)
- [Pagination](#pagination)
- [Error Handling](#error-handling)
- [Device Endpoints](#device-endpoints)
  - [List Devices](#list-devices)
  - [Get Device](#get-device)
  - [Create Device](#create-device)
  - [Update Device](#update-device)
  - [Delete Device](#delete-device)
  - [Get Device History](#get-device-history)
- [Reading Endpoints](#reading-endpoints)
  - [Query Readings](#query-readings)
  - [Get Latest Readings](#get-latest-readings)
  - [Ingest Readings](#ingest-readings)
- [Analytics Endpoints](#analytics-endpoints)
  - [Health Analytics](#health-analytics)
  - [Energy Analytics](#energy-analytics)
  - [Anomaly Analytics](#anomaly-analytics)
  - [Maintenance Forecast](#maintenance-forecast)
  - [Temperature Correlation](#temperature-correlation)
- [Metadata Endpoints](#metadata-endpoints)
  - [Get Metadata](#get-metadata)
- [Audit Endpoints](#audit-endpoints)
  - [Query Audit Logs](#query-audit-logs)
- [Metrics Endpoints](#metrics-endpoints)
  - [Get Metrics](#get-metrics)
- [Error Code Reference](#error-code-reference)
- [TypeScript Client Usage](#typescript-client-usage)

---

## Overview

The Infrasight V2 API provides RESTful endpoints for managing IoT devices, ingesting sensor readings, and retrieving analytics data. All endpoints use JSON for request and response bodies.

### Key Features

- **Zod Validation**: All inputs are validated using Zod schemas
- **Consistent Error Handling**: Standardized error responses with error codes
- **Pagination**: Offset-based pagination for list endpoints
- **Rate Limiting**: Configurable rate limits for mutation and ingestion endpoints
- **Audit Trails**: Complete change history for devices
- **Real-time Updates**: Pusher integration for live data streaming

---

## Base URL

```
/api/v2
```

All endpoints are prefixed with `/api/v2/`.

---

## Authentication

Authentication is **optional** in development mode. When enabled, use API key authentication:

```http
X-API-Key: your-api-key
```

### API Key Roles

| Role       | Permissions                                     |
| ---------- | ----------------------------------------------- |
| `admin`    | Full access to all endpoints                    |
| `operator` | Create, update, delete devices; ingest readings |
| `viewer`   | Read-only access to devices and readings        |

---

## Common Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message",
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5,
    "hasNext": true,
    "hasPrevious": false
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "Device 'device_999' not found",
    "statusCode": 404,
    "details": {
      "resource": "Device",
      "id": "device_999"
    }
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

## Pagination

List endpoints support offset-based pagination:

| Parameter | Type    | Default | Max                      | Description             |
| --------- | ------- | ------- | ------------------------ | ----------------------- |
| `page`    | integer | 1       | -                        | Page number (1-indexed) |
| `limit`   | integer | 20      | 100 (1000 for analytics) | Items per page          |

### Sorting

| Parameter       | Type            | Default | Description      |
| --------------- | --------------- | ------- | ---------------- |
| `sortBy`        | string          | varies  | Field to sort by |
| `sortDirection` | `asc` \| `desc` | `desc`  | Sort direction   |

---

## Error Handling

All errors follow a consistent format with machine-readable error codes.

### HTTP Status Codes

| Status | Meaning                       |
| ------ | ----------------------------- |
| 200    | Success                       |
| 201    | Created                       |
| 400    | Validation Error              |
| 401    | Unauthorized                  |
| 403    | Forbidden                     |
| 404    | Not Found                     |
| 409    | Conflict (duplicate resource) |
| 410    | Gone (soft-deleted resource)  |
| 422    | Unprocessable Entity          |
| 429    | Rate Limit Exceeded           |
| 500    | Internal Server Error         |

---

## Device Endpoints

### List Devices

Retrieve a paginated list of devices with filtering and sorting.

```http
GET /api/v2/devices
```

#### Query Parameters

| Parameter                   | Type            | Default      | Description                                     |
| --------------------------- | --------------- | ------------ | ----------------------------------------------- |
| `page`                      | integer         | 1            | Page number                                     |
| `limit`                     | integer         | 20           | Items per page (max 100)                        |
| `sortBy`                    | string          | `created_at` | Sort field                                      |
| `sortDirection`             | `asc` \| `desc` | `desc`       | Sort direction                                  |
| `status`                    | string          | -            | Filter by status (comma-separated for multiple) |
| `type`                      | string          | -            | Filter by device type (comma-separated)         |
| `building_id`               | string          | -            | Filter by building ID                           |
| `floor`                     | integer         | -            | Filter by floor number                          |
| `zone`                      | string          | -            | Filter by zone                                  |
| `department`                | string          | -            | Filter by department                            |
| `manufacturer`              | string          | -            | Filter by manufacturer                          |
| `tags`                      | string          | -            | Filter by tags (comma-separated)                |
| `min_battery`               | integer         | -            | Minimum battery level                           |
| `max_battery`               | integer         | -            | Maximum battery level                           |
| `offline_threshold_minutes` | integer         | 5            | Minutes before device considered offline        |
| `include_deleted`           | boolean         | false        | Include soft-deleted devices                    |
| `only_deleted`              | boolean         | false        | Only show soft-deleted devices                  |
| `startDate`                 | ISO date        | -            | Filter by date range start                      |
| `endDate`                   | ISO date        | -            | Filter by date range end                        |
| `date_filter_field`         | string          | `created_at` | Field for date filtering                        |
| `search`                    | string          | -            | Search in serial_number, room_name, tags        |
| `fields`                    | string          | -            | Comma-separated fields to include               |

#### Sort Fields

- `created_at`, `updated_at`, `last_seen`
- `serial_number`, `status`, `manufacturer`
- `floor`, `building_id`
- `uptime_percentage`, `battery_level`

#### Example Request

```bash
curl -X GET "http://localhost:3000/api/v2/devices?status=active&floor=1&limit=10&sortBy=last_seen&sortDirection=desc"
```

#### Example Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "device_001",
      "serial_number": "SN-2026-001",
      "manufacturer": "SensorCorp",
      "device_model": "TempSense Pro",
      "firmware_version": "2.1.0",
      "type": "temperature",
      "status": "active",
      "location": {
        "building_id": "main-building",
        "floor": 1,
        "room_name": "Conference Room A",
        "zone": "east-wing"
      },
      "health": {
        "last_seen": "2026-01-05T11:55:00.000Z",
        "uptime_percentage": 99.5,
        "error_count": 0,
        "battery_level": 85
      },
      "configuration": {
        "threshold_warning": 25,
        "threshold_critical": 30,
        "sampling_interval": 60
      },
      "metadata": {
        "tags": ["hvac", "critical"],
        "department": "facilities"
      },
      "compliance": {
        "requires_encryption": false,
        "data_classification": "internal",
        "retention_days": 90
      },
      "audit": {
        "created_at": "2026-01-01T00:00:00.000Z",
        "created_by": "admin",
        "updated_at": "2026-01-05T10:00:00.000Z",
        "updated_by": "system"
      }
    }
  ],
  "pagination": {
    "total": 250,
    "page": 1,
    "limit": 10,
    "totalPages": 25,
    "hasNext": true,
    "hasPrevious": false
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

#### TypeScript Usage

```typescript
import { v2Api } from '@/lib/api/v2-client';

const response = await v2Api.devices.list({
  status: 'active',
  floor: 1,
  limit: 10,
  sortBy: 'last_seen',
  sortDirection: 'desc',
});

console.log(response.data); // DeviceV2Response[]
console.log(response.pagination.total); // number
```

---

### Get Device

Retrieve a single device by ID with optional recent readings.

```http
GET /api/v2/devices/:id
```

#### Path Parameters

| Parameter | Type   | Description                    |
| --------- | ------ | ------------------------------ |
| `id`      | string | Device ID (e.g., `device_001`) |

#### Query Parameters

| Parameter                 | Type    | Default | Description                          |
| ------------------------- | ------- | ------- | ------------------------------------ |
| `fields`                  | string  | -       | Comma-separated fields to include    |
| `include_recent_readings` | boolean | false   | Include recent readings              |
| `readings_limit`          | integer | 10      | Number of recent readings to include |

#### Example Request

```bash
curl -X GET "http://localhost:3000/api/v2/devices/device_001?include_recent_readings=true&readings_limit=5"
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "_id": "device_001",
    "serial_number": "SN-2026-001",
    "type": "temperature",
    "status": "active",
    "location": {
      "building_id": "main-building",
      "floor": 1,
      "room_name": "Conference Room A"
    },
    "health": {
      "last_seen": "2026-01-05T11:55:00.000Z",
      "uptime_percentage": 99.5,
      "error_count": 0
    },
    "recent_readings": [
      {
        "value": 22.5,
        "timestamp": "2026-01-05T11:55:00.000Z",
        "metadata": {
          "type": "temperature",
          "unit": "celsius"
        }
      }
    ]
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

#### Error Responses

| Status | Error Code         | Description                  |
| ------ | ------------------ | ---------------------------- |
| 404    | `DEVICE_NOT_FOUND` | Device does not exist        |
| 410    | `NOT_FOUND`        | Device has been soft-deleted |

---

### Create Device

Create a new device with full validation.

```http
POST /api/v2/devices
```

#### Request Body

```json
{
  "_id": "device_501",
  "serial_number": "SN-2026-501",
  "manufacturer": "SensorCorp",
  "device_model": "TempSense Pro",
  "firmware_version": "2.1.0",
  "type": "temperature",
  "configuration": {
    "threshold_warning": 25,
    "threshold_critical": 30,
    "sampling_interval": 60,
    "calibration_offset": 0
  },
  "location": {
    "building_id": "main-building",
    "floor": 2,
    "room_name": "Office 201",
    "zone": "west-wing"
  },
  "metadata": {
    "tags": ["hvac"],
    "department": "engineering"
  },
  "compliance": {
    "requires_encryption": false,
    "data_classification": "internal",
    "retention_days": 90
  }
}
```

#### Required Fields

- `_id` - Custom device ID (format: `device_XXX` or alphanumeric)
- `serial_number` - Unique serial number
- `manufacturer` - Device manufacturer
- `device_model` - Device model name
- `firmware_version` - Firmware version
- `type` - Device type (see [Device Types](#device-types))
- `configuration` - Threshold and calibration settings
- `location` - Building, floor, and room information

#### Device Types

- `temperature`, `humidity`, `occupancy`, `power`, `co2`
- `pressure`, `light`, `motion`, `air_quality`, `water_flow`
- `gas`, `vibration`, `voltage`, `current`, `energy`

#### Example Request

```bash
curl -X POST "http://localhost:3000/api/v2/devices" \
  -H "Content-Type: application/json" \
  -d '{
    "_id": "device_501",
    "serial_number": "SN-2026-501",
    "manufacturer": "SensorCorp",
    "device_model": "TempSense Pro",
    "firmware_version": "2.1.0",
    "type": "temperature",
    "configuration": {
      "threshold_warning": 25,
      "threshold_critical": 30
    },
    "location": {
      "building_id": "main-building",
      "floor": 2,
      "room_name": "Office 201"
    }
  }'
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "_id": "device_501",
    "serial_number": "SN-2026-501",
    "status": "active",
    "health": {
      "last_seen": "2026-01-05T12:00:00.000Z",
      "uptime_percentage": 100,
      "error_count": 0
    },
    "audit": {
      "created_at": "2026-01-05T12:00:00.000Z",
      "created_by": "api-user"
    }
  },
  "message": "Device created successfully",
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

#### Error Responses

| Status | Error Code             | Description                  |
| ------ | ---------------------- | ---------------------------- |
| 400    | `VALIDATION_ERROR`     | Invalid request body         |
| 409    | `SERIAL_NUMBER_EXISTS` | Serial number already in use |
| 409    | `DEVICE_ID_EXISTS`     | Device ID already exists     |

---

### Update Device

Partially update a device. All fields are optional.

```http
PATCH /api/v2/devices/:id
```

#### Path Parameters

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Device ID   |

#### Request Body

```json
{
  "status": "maintenance",
  "status_reason": "Scheduled calibration",
  "firmware_version": "2.2.0",
  "configuration": {
    "threshold_warning": 26
  },
  "health": {
    "battery_level": 75
  }
}
```

#### Updatable Fields

- `serial_number`, `manufacturer`, `device_model`, `firmware_version`
- `status`, `status_reason`
- `configuration` (partial updates supported)
- `location` (partial updates supported)
- `metadata` (partial updates supported)
- `compliance` (partial updates supported)
- `health` (partial updates supported)

#### Device Status Values

- `active` - Device is operational
- `maintenance` - Device is under maintenance
- `offline` - Device is not responding
- `error` - Device has errors
- `decommissioned` - Device has been retired

#### Example Request

```bash
curl -X PATCH "http://localhost:3000/api/v2/devices/device_001" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "maintenance",
    "status_reason": "Firmware upgrade"
  }'
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "_id": "device_001",
    "status": "maintenance",
    "status_reason": "Firmware upgrade",
    "audit": {
      "updated_at": "2026-01-05T12:00:00.000Z",
      "updated_by": "api-user"
    }
  },
  "message": "Device updated successfully",
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

### Delete Device

Soft delete a device. The device will have status `decommissioned` and `audit.deleted_at` set.

```http
DELETE /api/v2/devices/:id
```

#### Path Parameters

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Device ID   |

#### Example Request

```bash
curl -X DELETE "http://localhost:3000/api/v2/devices/device_001"
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "_id": "device_001",
    "deleted": true,
    "deleted_at": "2026-01-05T12:00:00.000Z"
  },
  "message": "Device deleted successfully",
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

### Get Device History

Retrieve the audit trail for a device.

```http
GET /api/v2/devices/:id/history
```

#### Path Parameters

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Device ID   |

#### Query Parameters

| Parameter   | Type     | Default | Description                                             |
| ----------- | -------- | ------- | ------------------------------------------------------- |
| `page`      | integer  | 1       | Page number                                             |
| `limit`     | integer  | 20      | Items per page                                          |
| `startDate` | ISO date | -       | Filter by date range start                              |
| `endDate`   | ISO date | -       | Filter by date range end                                |
| `action`    | string   | -       | Filter by action type (`created`, `updated`, `deleted`) |
| `user`      | string   | -       | Filter by user                                          |

#### Example Request

```bash
curl -X GET "http://localhost:3000/api/v2/devices/device_001/history?limit=10"
```

---

## Reading Endpoints

### Query Readings

Query sensor readings with filtering and pagination.

```http
GET /api/v2/readings
```

#### Query Parameters

| Parameter           | Type            | Default     | Description                                                        |
| ------------------- | --------------- | ----------- | ------------------------------------------------------------------ |
| `page`              | integer         | 1           | Page number                                                        |
| `limit`             | integer         | 20          | Items per page (max 100)                                           |
| `sortBy`            | string          | `timestamp` | Sort field                                                         |
| `sortDirection`     | `asc` \| `desc` | `desc`      | Sort direction                                                     |
| `device_id`         | string          | -           | Filter by device ID (comma-separated for multiple)                 |
| `type`              | string          | -           | Filter by reading type                                             |
| `source`            | string          | -           | Filter by source (`sensor`, `simulation`, `manual`, `calibration`) |
| `startDate`         | ISO date        | -           | Start of time range                                                |
| `endDate`           | ISO date        | -           | End of time range                                                  |
| `is_valid`          | boolean         | -           | Filter by validity                                                 |
| `is_anomaly`        | boolean         | -           | Filter by anomaly flag                                             |
| `min_confidence`    | number          | -           | Minimum confidence score (0-1)                                     |
| `min_anomaly_score` | number          | -           | Minimum anomaly score (0-1)                                        |
| `min_value`         | number          | -           | Minimum reading value                                              |
| `max_value`         | number          | -           | Maximum reading value                                              |
| `fields`            | string          | -           | Fields to include                                                  |

**Note**: Either `device_id` or `startDate` must be provided to prevent full collection scans.

#### Example Request

```bash
curl -X GET "http://localhost:3000/api/v2/readings?device_id=device_001&startDate=2026-01-01T00:00:00.000Z&limit=50"
```

#### Example Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "64abc123...",
      "metadata": {
        "device_id": "device_001",
        "type": "temperature",
        "unit": "celsius",
        "source": "sensor"
      },
      "timestamp": "2026-01-05T11:55:00.000Z",
      "value": 22.5,
      "quality": {
        "is_valid": true,
        "confidence_score": 0.98,
        "is_anomaly": false
      },
      "processing": {
        "ingested_at": "2026-01-05T11:55:01.000Z"
      }
    }
  ],
  "pagination": {
    "total": 1000,
    "page": 1,
    "limit": 50,
    "totalPages": 20,
    "hasNext": true,
    "hasPrevious": false
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

### Get Latest Readings

Get the most recent reading for each device.

```http
GET /api/v2/readings/latest
```

#### Query Parameters

| Parameter                 | Type    | Required | Description                               |
| ------------------------- | ------- | -------- | ----------------------------------------- |
| `device_ids`              | string  | Yes      | Comma-separated device IDs                |
| `type`                    | string  | No       | Filter by reading type                    |
| `include_invalid`         | boolean | No       | Include invalid readings (default: false) |
| `include_quality_metrics` | boolean | No       | Include 24-hour quality metrics           |

#### Example Request

```bash
curl -X GET "http://localhost:3000/api/v2/readings/latest?device_ids=device_001,device_002&include_quality_metrics=true"
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "readings": [
      {
        "device_id": "device_001",
        "type": "temperature",
        "value": 22.5,
        "unit": "celsius",
        "timestamp": "2026-01-05T11:55:00.000Z",
        "quality": {
          "is_valid": true,
          "confidence_score": 0.98
        }
      }
    ],
    "count": 1,
    "quality_metrics": [
      {
        "device_id": "device_001",
        "total_readings": 1440,
        "valid_readings": 1438,
        "validity_percentage": 99.86,
        "anomaly_count": 2,
        "avg_confidence": 0.975
      }
    ]
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

### Ingest Readings

Bulk insert sensor readings.

```http
POST /api/v2/readings/ingest
```

#### Request Body

```json
{
  "readings": [
    {
      "device_id": "device_001",
      "type": "temperature",
      "unit": "celsius",
      "timestamp": "2026-01-05T11:55:00.000Z",
      "value": 22.5,
      "source": "sensor",
      "confidence_score": 0.98,
      "battery_level": 85,
      "signal_strength": -45
    }
  ],
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000",
  "batch_source": "gateway-001"
}
```

#### Request Fields

| Field             | Type   | Required | Description                  |
| ----------------- | ------ | -------- | ---------------------------- |
| `readings`        | array  | Yes      | Array of readings (1-10,000) |
| `idempotency_key` | UUID   | No       | Prevent duplicate ingestion  |
| `batch_source`    | string | No       | Identify batch source        |

#### Reading Object

| Field                | Type            | Required | Description                                 |
| -------------------- | --------------- | -------- | ------------------------------------------- |
| `device_id`          | string          | Yes      | Device ID                                   |
| `type`               | string          | Yes      | Reading type                                |
| `unit`               | string          | No       | Measurement unit (auto-detected if omitted) |
| `timestamp`          | ISO date/number | Yes      | Reading timestamp                           |
| `value`              | number          | Yes      | Reading value                               |
| `source`             | string          | No       | Source (default: `sensor`)                  |
| `confidence_score`   | number          | No       | Confidence score (0-1)                      |
| `battery_level`      | number          | No       | Battery level (0-100)                       |
| `signal_strength`    | number          | No       | Signal strength (dBm)                       |
| `raw_value`          | number          | No       | Pre-calibration value                       |
| `calibration_offset` | number          | No       | Calibration offset applied                  |

#### Example Request

```bash
curl -X POST "http://localhost:3000/api/v2/readings/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "readings": [
      {
        "device_id": "device_001",
        "type": "temperature",
        "timestamp": 1735996500000,
        "value": 22.5
      },
      {
        "device_id": "device_002",
        "type": "humidity",
        "timestamp": "2026-01-05T11:55:00.000Z",
        "value": 45
      }
    ]
  }'
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "inserted": 2,
    "rejected": 0,
    "errors": [],
    "total_errors": 0
  },
  "message": "Ingested 2 readings",
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

#### Error Response (Partial Success)

```json
{
  "success": true,
  "data": {
    "inserted": 1,
    "rejected": 1,
    "errors": [
      {
        "index": 1,
        "device_id": "device_999",
        "error": "Device 'device_999' not found"
      }
    ],
    "total_errors": 1
  },
  "message": "Ingested 1 readings",
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

## Analytics Endpoints

### Health Analytics

Get device health dashboard metrics.

```http
GET /api/v2/analytics/health
```

#### Query Parameters

| Parameter                   | Type    | Default | Description                      |
| --------------------------- | ------- | ------- | -------------------------------- |
| `building_id`               | string  | -       | Filter by building               |
| `floor`                     | integer | -       | Filter by floor                  |
| `department`                | string  | -       | Filter by department             |
| `offline_threshold_minutes` | integer | 5       | Minutes before device is offline |
| `battery_warning_threshold` | integer | 20      | Low battery threshold %          |

#### Example Request

```bash
curl -X GET "http://localhost:3000/api/v2/analytics/health?building_id=main-building&floor=1"
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_devices": 500,
      "active_devices": 485,
      "health_score": 97,
      "uptime_stats": {
        "avg_uptime": 99.2,
        "min_uptime": 85.0,
        "max_uptime": 100.0,
        "total_errors": 15
      }
    },
    "status_breakdown": [
      { "status": "active", "count": 485 },
      { "status": "offline", "count": 10 },
      { "status": "maintenance", "count": 3 },
      { "status": "error", "count": 2 }
    ],
    "alerts": {
      "offline_devices": {
        "count": 10,
        "threshold_minutes": 5,
        "devices": [...]
      },
      "low_battery_devices": {
        "count": 5,
        "threshold_percent": 20,
        "devices": [...]
      },
      "error_devices": {
        "count": 2,
        "devices": [...]
      },
      "maintenance_due": {
        "count": 8,
        "devices": [...]
      },
      "predictive_maintenance": {
        "count": 3,
        "devices": [
          {
            "id": "device_042",
            "serial_number": "SN-042",
            "room_name": "Server Room",
            "issue_type": "battery_critical",
            "severity": "critical"
          }
        ]
      }
    },
    "filters_applied": {
      "building_id": "main-building",
      "floor": 1,
      "department": null
    }
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

### Energy Analytics

Get energy consumption analytics.

```http
GET /api/v2/analytics/energy
```

#### Query Parameters

| Parameter         | Type     | Default | Description              |
| ----------------- | -------- | ------- | ------------------------ |
| `device_id`       | string   | -       | Filter by device(s)      |
| `startDate`       | ISO date | -       | Start of time range      |
| `endDate`         | ISO date | -       | End of time range        |
| `aggregation`     | string   | `avg`   | Aggregation type         |
| `granularity`     | string   | `hour`  | Time bucket size         |
| `type`            | string   | -       | Filter by reading type   |
| `include_invalid` | boolean  | false   | Include invalid readings |
| `group_by`        | string   | -       | Group by dimension       |
| `compare_with`    | string   | -       | Comparison period        |
| `page`            | integer  | 1       | Page number              |
| `limit`           | integer  | 20      | Items per page           |

#### Aggregation Types

- `raw`, `avg`, `sum`, `min`, `max`, `count`, `first`, `last`

#### Granularity Options

- `second`, `minute`, `hour`, `day`, `week`, `month`

#### Group By Options

- `device`, `type`, `floor`, `room`, `building`, `department`

---

### Anomaly Analytics

Get anomaly detection results and trends.

```http
GET /api/v2/analytics/anomalies
```

#### Query Parameters

| Parameter            | Type            | Default     | Description               |
| -------------------- | --------------- | ----------- | ------------------------- |
| `page`               | integer         | 1           | Page number               |
| `limit`              | integer         | 100         | Items per page (max 1000) |
| `device_id`          | string          | -           | Filter by device(s)       |
| `type`               | string          | -           | Filter by reading type    |
| `startDate`          | ISO date        | -           | Start of time range       |
| `endDate`            | ISO date        | -           | End of time range         |
| `min_score`          | number          | -           | Minimum anomaly score     |
| `bucket_granularity` | string          | -           | Time bucket for trends    |
| `sortBy`             | string          | `timestamp` | Sort field                |
| `sortDirection`      | `asc` \| `desc` | `desc`      | Sort direction            |

#### Example Request

```bash
curl -X GET "http://localhost:3000/api/v2/analytics/anomalies?startDate=2026-01-01&min_score=0.8&bucket_granularity=hour"
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "anomalies": [
      {
        "_id": "64abc...",
        "timestamp": "2026-01-05T10:30:00.000Z",
        "value": 45.2,
        "metadata": {
          "device_id": "device_015",
          "type": "temperature",
          "unit": "celsius"
        },
        "quality": {
          "is_anomaly": true,
          "anomaly_score": 0.92
        }
      }
    ],
    "pagination": {
      "total": 25,
      "page": 1,
      "limit": 100,
      "totalPages": 1
    },
    "summary": {
      "total_anomalies": 25,
      "by_device": [{ "device_id": "device_015", "count": 8, "avg_score": 0.85 }],
      "by_type": [{ "type": "temperature", "count": 15, "avg_score": 0.82 }]
    },
    "trends": [{ "time_bucket": "2026-01-05T10:00:00", "count": 5, "avg_score": 0.88 }],
    "filters_applied": {
      "min_score": 0.8,
      "time_range": { "start": "2026-01-01" }
    }
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

### Maintenance Forecast

Get predictive maintenance forecasts.

```http
GET /api/v2/analytics/maintenance-forecast
```

#### Query Parameters

| Parameter      | Type    | Default | Description           |
| -------------- | ------- | ------- | --------------------- |
| `building_id`  | string  | -       | Filter by building    |
| `floor`        | integer | -       | Filter by floor       |
| `device_type`  | string  | -       | Filter by device type |
| `horizon_days` | integer | 30      | Forecast horizon      |

---

### Temperature Correlation

Analyze temperature correlations across devices.

```http
GET /api/v2/analytics/temperature-correlation
```

#### Query Parameters

| Parameter     | Type     | Required | Description                      |
| ------------- | -------- | -------- | -------------------------------- |
| `device_ids`  | string   | Yes      | Comma-separated device IDs       |
| `startDate`   | ISO date | Yes      | Start of time range              |
| `endDate`     | ISO date | Yes      | End of time range                |
| `granularity` | string   | No       | Time bucket size (default: hour) |

---

## Metadata Endpoints

### Get Metadata

Get aggregated system metadata including manufacturers, departments, buildings, and device statistics.

```http
GET /api/v2/metadata
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "manufacturers": [
      { "name": "SensorCorp", "device_count": 200, "models": ["TempSense Pro", "HumidiSense"] }
    ],
    "departments": [
      { "name": "facilities", "device_count": 150, "cost_centers": ["CC-100"] }
    ],
    "device_types": [
      { "type": "temperature", "total": 100, "by_status": { "active": 95, "offline": 5 } }
    ],
    "buildings": [
      {
        "building": "main-building",
        "device_count": 300,
        "floors": [
          { "floor": 1, "device_count": 100, "rooms": [...] }
        ]
      }
    ],
    "tags": [
      { "tag": "hvac", "device_count": 80 }
    ],
    "statistics": {
      "total_devices": 500,
      "total_readings": 1500000,
      "last_24_hours": { ... },
      "last_7_days": { ... }
    },
    "schema_info": {
      "version": "2.0",
      "device_collection": "devices_v2",
      "readings_collection": "readings_v2",
      "api_version": "v2"
    }
  },
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

---

## Audit Endpoints

### Query Audit Logs

Query the system audit log.

```http
GET /api/v2/audit
```

#### Query Parameters

| Parameter    | Type     | Default | Description         |
| ------------ | -------- | ------- | ------------------- |
| `page`       | integer  | 1       | Page number         |
| `limit`      | integer  | 20      | Items per page      |
| `userId`     | string   | -       | Filter by user      |
| `actionType` | string   | -       | Filter by action    |
| `startDate`  | ISO date | -       | Start of time range |
| `endDate`    | ISO date | -       | End of time range   |

---

## Metrics Endpoints

### Get Metrics

Get system metrics in Prometheus format.

```http
GET /api/v2/metrics
```

---

## Error Code Reference

### Authentication Errors (401, 403)

| Code            | Status | Description                  |
| --------------- | ------ | ---------------------------- |
| `UNAUTHORIZED`  | 401    | Authentication required      |
| `FORBIDDEN`     | 403    | Insufficient permissions     |
| `INVALID_TOKEN` | 401    | Invalid authentication token |
| `TOKEN_EXPIRED` | 401    | Authentication token expired |

### Validation Errors (400)

| Code                     | Status | Description                     |
| ------------------------ | ------ | ------------------------------- |
| `BAD_REQUEST`            | 400    | Request could not be understood |
| `INVALID_INPUT`          | 400    | Invalid input provided          |
| `VALIDATION_ERROR`       | 400    | Input validation failed         |
| `INVALID_QUERY_PARAM`    | 400    | Invalid query parameter         |
| `INVALID_BODY`           | 400    | Invalid request body            |
| `MISSING_REQUIRED_FIELD` | 400    | Required field is missing       |
| `INVALID_FORMAT`         | 400    | Invalid value format            |
| `INVALID_DATE_RANGE`     | 400    | Invalid date range              |
| `INVALID_PAGINATION`     | 400    | Invalid pagination parameters   |

### Not Found Errors (404)

| Code                 | Status | Description        |
| -------------------- | ------ | ------------------ |
| `NOT_FOUND`          | 404    | Resource not found |
| `DEVICE_NOT_FOUND`   | 404    | Device not found   |
| `READING_NOT_FOUND`  | 404    | Reading not found  |
| `BUILDING_NOT_FOUND` | 404    | Building not found |
| `FLOOR_NOT_FOUND`    | 404    | Floor not found    |

### Conflict Errors (409)

| Code                      | Status | Description                          |
| ------------------------- | ------ | ------------------------------------ |
| `CONFLICT`                | 409    | Request conflicts with current state |
| `DUPLICATE_RESOURCE`      | 409    | Resource already exists              |
| `SERIAL_NUMBER_EXISTS`    | 409    | Serial number already in use         |
| `DEVICE_ID_EXISTS`        | 409    | Device ID already exists             |
| `CONCURRENT_MODIFICATION` | 409    | Resource modified by another request |

### Business Logic Errors (422)

| Code                    | Status | Description                           |
| ----------------------- | ------ | ------------------------------------- |
| `UNPROCESSABLE_ENTITY`  | 422    | Semantic error in request             |
| `INVALID_READING`       | 422    | Reading value invalid or out of range |
| `INVALID_DEVICE_STATUS` | 422    | Invalid status transition             |
| `DEVICE_OFFLINE`        | 422    | Device is offline                     |
| `DEVICE_IN_MAINTENANCE` | 422    | Device is in maintenance              |
| `THRESHOLD_EXCEEDED`    | 422    | Threshold value exceeded              |
| `CALIBRATION_REQUIRED`  | 422    | Device calibration required           |

### Rate Limiting (429)

| Code                  | Status | Description                 |
| --------------------- | ------ | --------------------------- |
| `RATE_LIMIT_EXCEEDED` | 429    | Too many requests           |
| `TOO_MANY_REQUESTS`   | 429    | Request rate limit exceeded |

### Server Errors (5xx)

| Code                  | Status | Description                           |
| --------------------- | ------ | ------------------------------------- |
| `INTERNAL_ERROR`      | 500    | Unexpected internal error             |
| `DATABASE_ERROR`      | 500    | Database error occurred               |
| `CONNECTION_ERROR`    | 500    | Connection to external service failed |
| `PUSHER_ERROR`        | 500    | Failed to broadcast real-time update  |
| `BAD_GATEWAY`         | 502    | Invalid upstream response             |
| `SERVICE_UNAVAILABLE` | 503    | Service temporarily unavailable       |
| `GATEWAY_TIMEOUT`     | 504    | Upstream server timeout               |

---

## TypeScript Client Usage

The V2 API client provides type-safe access to all endpoints.

### Installation

```typescript
import { v2Api, ApiClientError } from '@/lib/api/v2-client';
```

### Devices

```typescript
// List devices
const response = await v2Api.devices.list({
  status: 'active',
  floor: 1,
  limit: 20,
});
console.log(response.data); // DeviceV2Response[]

// Get single device
const device = await v2Api.devices.getById('device_001');

// Update device
await v2Api.devices.update('device_001', {
  status: 'maintenance',
  status_reason: 'Calibration',
});

// Delete device
await v2Api.devices.delete('device_001');

// Get device history
const history = await v2Api.devices.getHistory('device_001', {
  startDate: '2026-01-01',
  endDate: '2026-01-05',
});
```

### Readings

```typescript
// List readings
const readings = await v2Api.readings.list({
  device_id: 'device_001',
  startDate: '2026-01-01',
  limit: 100,
});

// Get latest readings
const latest = await v2Api.readings.latest({
  device_ids: 'device_001,device_002',
  include_quality_metrics: true,
});
```

### Analytics

```typescript
// Health metrics
const health = await v2Api.analytics.health();

// Energy analytics
const energy = await v2Api.analytics.energy({
  granularity: 'hour',
  aggregationType: 'sum',
});

// Anomalies
const anomalies = await v2Api.analytics.anomalies({
  minScore: 0.8,
  startDate: '2026-01-01',
});

// Maintenance forecast
const forecast = await v2Api.analytics.maintenanceForecast({
  horizon_days: 30,
});
```

### Error Handling

```typescript
try {
  const device = await v2Api.devices.getById('device_999');
} catch (error) {
  if (error instanceof ApiClientError) {
    console.error(`Error [${error.errorCode}]: ${error.message}`);
    console.error(`Status: ${error.statusCode}`);
    console.error(`Details:`, error.details);
  }
}
```

### Retry Behavior

The client automatically retries on these status codes:

- 408 (Request Timeout)
- 429 (Too Many Requests)
- 500, 502, 503, 504 (Server Errors)

Default configuration:

- Max retries: 3
- Retry delay: 1 second (exponential backoff)

---

## Rate Limits

| Endpoint              | Limit                  | Window   |
| --------------------- | ---------------------- | -------- |
| POST /devices         | 100/minute per IP      | 1 minute |
| POST /readings/ingest | 1000/minute per device | 1 minute |
| POST /readings/ingest | 10000/minute per IP    | 1 minute |
| All other endpoints   | No limit               | -        |

Rate limit headers:

- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Changelog

### V2.0.0 (Current)

- Complete API rewrite with Zod validation
- MongoDB timeseries collections for readings
- 90-day TTL on readings
- Comprehensive audit trails
- Device health metrics
- Predictive maintenance analytics
- Rate limiting and caching
- Enhanced error handling with error codes

---

_Last Updated: 2026-01-05_
