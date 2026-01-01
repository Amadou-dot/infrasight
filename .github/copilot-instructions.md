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

**Example** (see [ReadingV2.ts](../models/v2/ReadingV2.ts)):
```typescript
metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' }
```

### Custom Device IDs (Not Auto-Generated)
Device `_id` is a **custom string** (`device_001`, not ObjectId). Must be set explicitly in code:
```typescript
await DeviceV2.create({ _id: 'device_050', serial_number: 'SN-12345', ... });
```
See [scripts/v2/seed-v2.ts](../scripts/v2/seed-v2.ts) for examples.

## Development Workflows

### Essential Commands
```bash
pnpm dev              # Next.js with Turbopack (localhost:3000)
pnpm build            # Production build
pnpm seed             # Populate 500 v2 test devices + readings
pnpm simulate         # Generate synthetic readings (real-time testing)
pnpm create-indexes-v2  # Create v2 collection indexes
pnpm test             # Test v2 API endpoints
```

### Required Environment Variables
All checked at import time—app fails loudly if missing:
- `MONGODB_URI`: Connection string
- `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`: Server-side real-time
- `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`: Client-side (must have `NEXT_PUBLIC_` prefix)

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
- **Error handling**: `withErrorHandler` wrapper (see [lib/errors/errorHandler.ts](../lib/errors/errorHandler.ts)) normalizes all errors to `ApiError` with consistent format
- **Responses**: Use `jsonSuccess()`, `jsonPaginated()` from `lib/api/response.ts` (NOT raw `NextResponse.json`)

### Model Anti-Patterns (Critical!)
1. **Always check `mongoose.models` before creating**:
   ```typescript
   const DeviceV2 = mongoose.models.DeviceV2 || mongoose.model('DeviceV2', schema);
   ```
   Hot reload will crash without this.

2. **Avoid `model` as field name in schemas** (conflicts with Mongoose Document.model):
   ```typescript
   // BAD: model: string
   // GOOD: device_model: string (see DeviceV2.ts)
   ```

3. **Don't mutate timeseries metadata fields** after collection creation—requires full migration.

### Frontend Real-Time Subscriptions
Components use Pusher client singleton ([lib/pusher-client.ts](../lib/pusher-client.ts)):
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
Dashboard uses typed client wrapper ([lib/api/v2-client.ts](../lib/api/v2-client.ts)):
```typescript
import { v2Api } from '@/lib/api/v2-client';

const response = await v2Api.devices.list({ floor: 1, status: 'active' });
// response.data is DeviceV2Response[]
```
Prefer this over raw `fetch()` for type safety.

## Project Structure Essentials

```
models/
  v2/DeviceV2.ts, ReadingV2.ts    # Production models (90-day TTL, audit trails)
  v1 (deprecated)/                 # Archived v1 models (excluded from compilation)
lib/
  db.ts                            # Global cached connection (prevents hot-reload leak)
  validations/v2/                  # Zod schemas for all v2 operations
  errors/                          # ApiError + error handling utilities
  api/v2-client.ts                 # Typed client for v2 endpoints
  deprecated/                      # Archived migration utilities
app/api/
  v2/                              # Production API routes
  _v1-deprecated/                  # Archived v1 routes (ignored by Next.js)
scripts/v2/                        # seed-v2, simulate, test-api
components/                        # React components (all use 'use client')
types/v2/                          # TypeScript types for v2 API contracts
```

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
1. Update `deviceTypeSchema` in both:
   - [models/v2/DeviceV2.ts](../models/v2/DeviceV2.ts) (enum array)
   - [lib/validations/v2/device.validation.ts](../lib/validations/v2/device.validation.ts) (Zod enum)
2. Update `ReadingType` in [models/v2/ReadingV2.ts](../models/v2/ReadingV2.ts) if needed
3. Add appropriate `ReadingUnit` enum values (e.g., for new measurement types)

### Debugging Connection Issues
- Check MongoDB connection: `lib/db.ts` has 5s timeout
- Verify env vars: All Pusher/MongoDB vars checked at import
- Use `pnpm test-v2` to validate v2 API responses

## Critical Pitfalls to Avoid

1. **Timeseries schema changes**: Cannot modify `metadata`, `timestamp`, or timeseries config after collection exists—requires full migration
2. **Custom IDs**: Never use ObjectId for Device `_id`—always string like `device_001`
3. **Mongoose model recompilation**: Always use `mongoose.models.X || mongoose.model()` pattern
4. **Client-side secrets**: Only `NEXT_PUBLIC_*` vars allowed in browser code
5. **Deprecated folders**: Never import from `_deprecated` folders—they are excluded from TypeScript compilation

## Key Files to Reference

- V2 models: [models/v2/DeviceV2.ts](../models/v2/DeviceV2.ts), [models/v2/ReadingV2.ts](../models/v2/ReadingV2.ts)
- Error handling: [lib/errors/errorHandler.ts](../lib/errors/errorHandler.ts), [lib/errors/errorCodes.ts](../lib/errors/errorCodes.ts)
- Validation schemas: [lib/validations/v2/](../lib/validations/v2/)
- API client: [lib/api/v2-client.ts](../lib/api/v2-client.ts)
- Quick start: [QUICK_START_V2.md](../plans/QUICK_START_V2.md)
