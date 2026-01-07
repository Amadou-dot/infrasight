# AI Coding Agent Instructions for Infrasight

## Project Overview

**Infrasight** is a real-time IoT sensor monitoring dashboard for building management, built with **Next.js 15** (Turbopack), **TypeScript**, **MongoDB** (Mongoose timeseries), and **Pusher** for real-time updates. It tracks environmental sensors across building floors and rooms.

## Critical Architecture Decisions

### V2 API (Production)

The migration from v1 to v2 is **complete**. All code now uses v2 exclusively:

- **V2 Collections**: `devices_v2`, `readings_v2` (enhanced with audit trails, health metrics, compliance, 90-day TTL)
- **V2 API**: All endpoints under `/api/v2/`
- **V1 Deprecated**: All v1 files moved to `_deprecated` folders and excluded from TypeScript compilation

**Important**: Only use v2 models and APIs. V1 code exists only for historical reference.

### MongoDB Timeseries Collections

Readings use MongoDB timeseries with **critical constraints**:

- `timeField: 'timestamp'`, `metaField: 'metadata'`, `granularity: 'seconds'`
- `metadata` field is the bucketing key—keep **LOW CARDINALITY** (device_id, type, unit, source only)
- Cannot modify schema fields after creation without recreating collection
- TTL: 90 days (`expireAfterSeconds`)
- **15 Device/Reading Types**: temperature, humidity, occupancy, power, co2, pressure, light, motion, air_quality, water_flow, gas, vibration, voltage, current, energy
- **44+ Reading Units**: Comprehensive unit support (celsius, fahrenheit, kelvin, percent, ppm, watts, volts, lux, etc.)

**Example** (see [ReadingV2.ts](models/v2/ReadingV2.ts)):

```typescript
metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' }
```

### Custom Device IDs (Not Auto-Generated)

Device `_id` is a **custom string** (`device_001`, not ObjectId). Must be set explicitly in code:

```typescript
await DeviceV2.create({ _id: 'device_050', serial_number: 'SN-12345', ... });
```

See [scripts/v2/seed-v2.ts](scripts/v2/seed-v2.ts) for examples.

## Development Workflows

### Essential Commands

```bash
pnpm dev                # Next.js with Turbopack (localhost:3000)
pnpm build              # Production build
pnpm seed               # Populate 500 v2 test devices + readings
pnpm simulate           # Generate synthetic readings (real-time testing)
pnpm create-indexes-v2  # Create v2 collection indexes
pnpm verify-indexes     # Verify all required indexes exist
pnpm test               # Test v2 API endpoints
```

### Required Environment Variables

All checked at import time—app fails loudly if missing:

- `MONGODB_URI`: Connection string
- `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`: Server-side real-time
- `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`: Client-side (must have `NEXT_PUBLIC_` prefix)

**Optional (Phase 5 Features):**
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: Redis for caching and rate limiting
- `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`: Error tracking with Sentry
- `ENABLE_METRICS`: Enable Prometheus metrics endpoint (true/false)

Copy `example.env` → `.env.local` and populate.

## Code Patterns & Critical Conventions

### API Routes (V2 Standard)

V2 routes use **Zod validation + centralized error handling**:

```typescript
// See app/api/v2/devices/route.ts
export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    const validationResult = validateQuery(searchParams, listDevicesQuerySchema);
    if (!validationResult.success) throw new ApiError(...);

    const devices = await DeviceV2.findActive(filter);
    return jsonPaginated(devices, pagination, meta);
  });
}
```

- **Validation**: `lib/validations/v2/` contains Zod schemas for all v2 operations
- **Error handling**: `withErrorHandler` wrapper (see [lib/errors/errorHandler.ts](lib/errors/errorHandler.ts)) normalizes all errors to `ApiError` with consistent format
- **Responses**: Use `jsonSuccess()`, `jsonPaginated()` from `lib/api/response.ts` (NOT raw `NextResponse.json`)

### Model Anti-Patterns (Critical!)

1. **Always check `mongoose.models` before creating**:

   ```typescript
   const DeviceV2 =
     mongoose.models.DeviceV2 || mongoose.model('DeviceV2', schema);
   ```

   Hot reload will crash without this.

2. **Avoid `model` as field name in schemas** (conflicts with Mongoose Document.model):

   ```typescript
   // BAD: model: string
   // GOOD: device_model: string (see DeviceV2.ts)
   ```

3. **Don't mutate timeseries metadata fields** after collection creation—requires full migration.

### Frontend Real-Time Subscriptions

Components use Pusher client singleton ([lib/pusher-client.ts](lib/pusher-client.ts)):

```typescript
const pusher = getPusherClient();
const channel = pusher.subscribe('sensor-readings');
channel.bind('new-reading', (data: PusherReading) => {
  // Update local state
});
```

- **Pattern**: Subscribe in `useEffect`, unsubscribe on cleanup
- **Data shape**: `PusherReading` has `metadata.device_id`, `value`, `timestamp`
- **Event names**: No convention yet; common: `'new-reading'`, `'device-status'`

### V2 API Client Pattern

Dashboard uses typed client wrapper ([lib/api/v2-client.ts](lib/api/v2-client.ts)):

```typescript
import { v2Api } from '@/lib/api/v2-client';

const response = await v2Api.devices.list({ floor: 1, status: 'active' });
// response.data is DeviceV2Response[]
```

Prefer this over raw `fetch()` for type safety.

## V2 API Endpoints Reference

The v2 API provides 19 comprehensive endpoints organized into 6 categories:

### Device Management (6 endpoints)
- **GET /api/v2/devices** - List/filter devices with pagination, sorting, field projection
- **POST /api/v2/devices** - Create new device with audit trail
- **GET /api/v2/devices/[id]** - Get single device (optional: include recent readings)
- **PATCH /api/v2/devices/[id]** - Update device (supports nested field updates)
- **DELETE /api/v2/devices/[id]** - Soft delete device
- **GET /api/v2/devices/[id]/history** - Get device audit history

### Reading Data (3 endpoints)
- **GET /api/v2/readings** - Query readings with filters, time range, quality metrics
- **GET /api/v2/readings/latest** - Get latest readings per device
- **POST /api/v2/readings/ingest** - Bulk insert up to 10,000 readings

### Analytics & Intelligence (5 endpoints)
- **GET /api/v2/analytics/anomalies** - Anomaly detection with trend analysis
- **GET /api/v2/analytics/energy** - Energy/reading analytics with aggregation (sum, avg, min, max)
- **GET /api/v2/analytics/health** - Device health dashboard and alerts
- **GET /api/v2/analytics/temperature-correlation** - Temperature correlation and diagnosis
- **GET /api/v2/analytics/maintenance-forecast** - Predictive maintenance analytics

### System & Monitoring (3 endpoints)
- **GET /api/v2/audit** - Cross-device audit trail with filtering
- **GET /api/v2/metadata** - System metadata and configuration aggregates
- **GET /api/v2/metrics** - Prometheus-compatible metrics export

### Utilities (2 endpoints)
- **GET /api/v2/cron/simulate** - Generate synthetic readings for testing
- **GET/POST /api/v2/test-sentry** - Sentry error capture testing (dev only)

**Key Features:**
- Zod validation on all inputs
- Pagination with configurable limits
- Field projection support
- MongoDB aggregation pipelines for analytics
- Structured error handling with ApiError
- Rate limiting on POST operations (Phase 5)
- Redis caching for metadata/analytics (Phase 5)

## Project Structure Essentials

```
models/
  v2/DeviceV2.ts, ReadingV2.ts    # Production models (90-day TTL, audit trails)
  v1 (deprecated)/                 # Archived v1 models (excluded from compilation)
lib/
  db.ts                            # Global cached connection (prevents hot-reload leak)
  validations/v2/                  # Zod schemas for all v2 operations
  errors/                          # ApiError + error handling utilities
  api/
    v2-client.ts                   # Typed client for v2 endpoints
    response.ts, pagination.ts     # Response helpers and pagination utilities
  deprecated/                      # Archived migration utilities
  cache/                           # Redis caching with invalidation (Phase 5)
  monitoring/                      # Sentry, Prometheus metrics, logging, tracing (Phase 5)
  ratelimit/                       # Rate limiting config and middleware (Phase 5)
  redis/                           # Redis client configuration (Phase 5)
  auth/                            # Authentication, permissions, API keys (Phase 5)
  middleware/                      # Request validation, body size, headers (Phase 5)
  utils/                           # Correlation analysis, severity calculation
app/api/
  v2/                              # Production API routes (19 endpoints)
    devices/                       # Device CRUD + history
    readings/                      # Reading queries + ingest + latest
    analytics/                     # 5 analytics endpoints
    audit/, metadata/, metrics/    # System endpoints
    cron/simulate/                 # Synthetic data generator
  _v1-deprecated/                  # Archived v1 routes (ignored by Next.js)
scripts/v2/                        # seed-v2, simulate, test-api, create-indexes, verify-indexes
components/                        # React components (all use 'use client')
types/v2/                          # TypeScript types for v2 API contracts
```

## Phase 5: Security, Performance & Monitoring

The v2 API includes enterprise-grade features for production deployment:

### Rate Limiting
- **Implementation**: Upstash Redis-backed rate limiter
- **Default Limits**: 100 requests/minute for POST operations
- **Middleware**: `applyRateLimit()` in `lib/ratelimit/`
- **Endpoints**: Applied to device creation, reading ingestion

### Caching Strategy
- **Cache Provider**: Redis with cache-aside pattern
- **TTL**: 10 minutes for metadata, configurable per endpoint
- **Invalidation**: Automatic cache invalidation on create/update/delete operations
- **Keys**: Structured cache keys in `lib/cache/keys.ts`
- **Endpoints**: Metadata, analytics aggregations

### Authentication & Authorization
- **Method**: API key-based authentication (optional)
- **Middleware**: `requireAuth()`, `requirePermission()`
- **Context**: Request-scoped auth context with user/role info
- **Permissions**: Granular permission system (read, write, admin)
- **Integration**: Audit trails track authenticated users

### Monitoring & Observability
- **Error Tracking**: Sentry integration for error capture and analysis
- **Metrics**: Prometheus-compatible metrics export (GET /api/v2/metrics)
  - Request latency histograms
  - Error rate counters
  - Cache hit/miss ratios
  - Ingestion statistics
- **Logging**: Structured JSON logging with Winston
- **Tracing**: Request ID tracking for distributed tracing

### Request Validation & Security
- **Body Size Limits**: 10MB max for bulk operations
- **Request Validation**: Zod schema validation on all inputs
- **Security Headers**: CORS, CSP, rate limit headers
- **Sanitization**: Input sanitization in `lib/validations/sanitizer.ts`

## Validation Schemas

The v2 API uses comprehensive Zod schemas for all operations:

### Device Validation
- **createDeviceSchema**: Full device creation with all required fields
- **updateDeviceSchema**: Partial updates with at least one field required
- **listDevicesQuerySchema**: Pagination, sorting (11+ fields), filtering (status, type, building, floor, zone, department, tags, manufacturer, battery level)
- **getDeviceQuerySchema**: Field projection, include recent readings
- **deviceHistoryQuerySchema**: Audit history with action/user/date filters

### Reading Validation
- **createReadingSchema**: Single reading with metadata, timestamp, value, quality
- **bulkIngestReadingsSchema**: Bulk insert 1-10,000 readings with idempotency
- **listReadingsQuerySchema**: Time range (required), device filter, quality filters, value range
- **latestReadingsQuerySchema**: Latest readings per device with quality metrics
- **readingAnalyticsQuerySchema**: Aggregation (raw/avg/sum/min/max/count), granularity (second to month), grouping (device/type/floor/room/building/department)

### Common Validation Helpers
- **Pagination**: Cursor-based, offset-based, analytics (higher limits)
- **Date Ranges**: Past/future dates, range validation
- **Enumerations**: Device types (15), reading units (44+), statuses, sources
- **Field-Level**: ObjectIds, device IDs, serial numbers, percentages, coordinates, firmware versions

All schemas are in `lib/validations/v2/` with TypeScript type inference via `z.infer<>`.

## Common Tasks & Examples

### Adding a New V2 API Endpoint

1. Create Zod schema in `lib/validations/v2/` (e.g., `listAnomaliesQuerySchema`)
2. Add route in `app/api/v2/anomalies/route.ts`:
   ```typescript
   export async function GET(request: NextRequest) {
     return withErrorHandler(async () => {
       const query = validateQuery(searchParams, listAnomaliesQuerySchema);
       const anomalies = await ReadingV2.getAnomalies(query.data);
       return jsonSuccess(anomalies);
     });
   }
   ```
3. Add method to `v2Api` client in `lib/api/v2-client.ts`
4. Update types in `types/v2/api.types.ts`

### Adding a New Device Type

Currently supports **15 device types**: temperature, humidity, occupancy, power, co2, pressure, light, motion, air_quality, water_flow, gas, vibration, voltage, current, energy

To add a new type:
1. Update `deviceTypeSchema` in both:
   - [models/v2/DeviceV2.ts](models/v2/DeviceV2.ts) (enum array)
   - [lib/validations/v2/device.validation.ts](lib/validations/v2/device.validation.ts) (Zod enum)
2. Update `ReadingType` in [models/v2/ReadingV2.ts](models/v2/ReadingV2.ts) to match
3. Add appropriate `ReadingUnit` enum values (currently 44+ units supported)
4. Update unit mapping in `/api/v2/readings/ingest/route.ts` if auto-mapping is needed

### Using Model Static Methods

**DeviceV2 Methods:**
```typescript
// Find active (non-deleted) devices
const activeDevices = await DeviceV2.findActive({ status: 'active' });

// Find soft-deleted devices
const deletedDevices = await DeviceV2.findDeleted();

// Soft delete a device
await DeviceV2.softDelete('device_001', 'admin@example.com');

// Restore a soft-deleted device
await DeviceV2.restore('device_001');
```

**ReadingV2 Methods:**
```typescript
// Get latest reading for a device
const latest = await ReadingV2.getLatestForDevice('device_001', 'temperature');

// Get readings in time range
const readings = await ReadingV2.getForDeviceInRange(
  'device_001',
  startDate,
  endDate,
  { type: 'temperature', limit: 100, includeInvalid: false }
);

// Get anomalous readings
const anomalies = await ReadingV2.getAnomalies('device_001', {
  startTime: new Date('2024-01-01'),
  minScore: 0.7,
  limit: 50
});

// Bulk insert readings
await ReadingV2.bulkInsertReadings([
  { metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' }, value: 22.5 },
  // ... more readings
]);
```

### Debugging Connection Issues

- Check MongoDB connection: `lib/db.ts` has 5s timeout
- Verify env vars: All Pusher/MongoDB vars checked at import
- Use `pnpm test` to validate v2 API responses
- Check Redis connection: `lib/redis/client.ts` for cache/rate limit issues
- Monitor Sentry: Error tracking for production issues
- View metrics: `GET /api/v2/metrics` for Prometheus-compatible metrics

## Critical Pitfalls to Avoid

1. **Timeseries schema changes**: Cannot modify `metadata`, `timestamp`, or timeseries config after collection exists—requires full migration
2. **Custom IDs**: Never use ObjectId for Device `_id`—always string like `device_001`
3. **Mongoose model recompilation**: Always use `mongoose.models.X || mongoose.model()` pattern
4. **Client-side secrets**: Only `NEXT_PUBLIC_*` vars allowed in browser code
5. **Deprecated folders**: Never import from `_deprecated` folders—they are excluded from TypeScript compilation
6. **Rate limit bypass**: Don't skip rate limiting on public endpoints—always use `applyRateLimit()` for POST operations
7. **Cache invalidation**: Always invalidate relevant caches after create/update/delete operations
8. **Bulk insert limits**: Reading ingestion limited to 10,000 per request—batch larger datasets
9. **Analytics queries**: Always include time range for reading queries—required for timeseries efficiency
10. **Device type mismatch**: Ensure reading type matches device type—enforced at validation layer

## Key Files to Reference

### Core Models & Data
- V2 models: [models/v2/DeviceV2.ts](models/v2/DeviceV2.ts), [models/v2/ReadingV2.ts](models/v2/ReadingV2.ts)
- Database connection: [lib/db.ts](lib/db.ts)

### Validation & Error Handling
- Validation schemas: [lib/validations/v2/](lib/validations/v2/)
- Error handling: [lib/errors/errorHandler.ts](lib/errors/errorHandler.ts), [lib/errors/errorCodes.ts](lib/errors/errorCodes.ts)
- Sanitization: [lib/validations/sanitizer.ts](lib/validations/sanitizer.ts)

### API Layer
- API client: [lib/api/v2-client.ts](lib/api/v2-client.ts)
- Response helpers: [lib/api/response.ts](lib/api/response.ts), [lib/api/pagination.ts](lib/api/pagination.ts)
- API routes: [app/api/v2/](app/api/v2/)

### Phase 5: Security & Performance
- Rate limiting: [lib/ratelimit/](lib/ratelimit/)
- Caching: [lib/cache/](lib/cache/)
- Authentication: [lib/auth/](lib/auth/)
- Monitoring: [lib/monitoring/](lib/monitoring/)
- Redis: [lib/redis/](lib/redis/)
- Middleware: [lib/middleware/](lib/middleware/)

### Scripts & Utilities
- Seeding: [scripts/v2/seed-v2.ts](scripts/v2/seed-v2.ts)
- Simulation: [scripts/v2/simulate.ts](scripts/v2/simulate.ts)
- Testing: [scripts/v2/test-api.ts](scripts/v2/test-api.ts)
- Indexing: [scripts/v2/create-indexes-v2.ts](scripts/v2/create-indexes-v2.ts), [scripts/v2/verify-indexes.ts](scripts/v2/verify-indexes.ts)

### Documentation
- Quick start: [QUICK_START_V2.md](plans/QUICK_START_V2.md)
- Phase 5 plan: [PLAN_PHASE_5.md](plans/PLAN_PHASE_5.md)
