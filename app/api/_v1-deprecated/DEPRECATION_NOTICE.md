# ⚠️ DEPRECATED - V1 API Routes

**Status:** DEPRECATED as of December 31, 2025  
**Location:** `app/api/_v1-deprecated/`

## Important Notice

These API routes are deprecated and should NOT be used in new development. They are preserved here for historical reference only.

## Replacement

All functionality has been migrated to the **v2 API**:

| Deprecated Route | V2 Replacement |
|------------------|----------------|
| `/api/devices` | `/api/v2/devices` |
| `/api/readings/latest` | `/api/v2/readings/latest` |
| `/api/metadata` | `/api/v2/metadata` |
| `/api/analytics/energy` | `/api/v2/analytics/energy` |
| `/api/cron/simulate` | Uses v2 models now (moved here for reference) |

## V2 API Client

Use the typed v2 API client for all new code:

```typescript
import { v2Api } from '@/lib/api/v2-client';

// Devices
const devices = await v2Api.devices.list({ floor: 1 });
const device = await v2Api.devices.getById('device_001');

// Readings
const readings = await v2Api.readings.latest({ device_ids: 'device_001,device_002' });

// Analytics
const health = await v2Api.analytics.health();
const anomalies = await v2Api.analytics.anomalies({ limit: 10 });
```

## Why Deprecated?

1. V1 used a simpler schema without audit trails, health metrics, or compliance fields
2. V1 lacked proper Zod validation and centralized error handling
3. V2 provides 90-day TTL vs 7-day TTL for readings
4. V2 includes proper TypeScript types for all API contracts

## Do Not

- ❌ Import from these files
- ❌ Reference these routes in new code
- ❌ Restore these to active status

## Removal Timeline

These files may be permanently deleted in a future release. They are excluded from TypeScript compilation via `tsconfig.json`.
