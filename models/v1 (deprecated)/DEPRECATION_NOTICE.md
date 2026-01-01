# ⚠️ DEPRECATED - V1 Models

**Status:** DEPRECATED as of December 31, 2025

## Important Notice

These Mongoose models are deprecated and should NOT be used in new development. They are preserved here for historical reference only.

## Replacement

All functionality has been migrated to **v2 models**:

| Deprecated Model | V2 Replacement |
|------------------|----------------|
| `Device` | `DeviceV2` from `@/models/v2/DeviceV2` |
| `Reading` | `ReadingV2` from `@/models/v2/ReadingV2` |

## V2 Model Usage

```typescript
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';

// Find active devices (excludes soft-deleted)
const devices = await DeviceV2.findActive({ status: 'active' });

// Get latest reading for a device
const reading = await ReadingV2.getLatestForDevice('device_001');

// Bulk insert readings
await ReadingV2.bulkInsertReadings(readings);
```

## Key Differences

### DeviceV2 vs Device
- Custom string `_id` instead of ObjectId
- Nested `location`, `metadata`, `audit`, `health`, `compliance` objects
- Soft delete support via `audit.deleted_at`
- Uses `device_model` instead of `model` (Mongoose conflict)

### ReadingV2 vs Reading
- MongoDB Timeseries collection with 90-day TTL
- Proper `metadata` bucketing for efficient queries
- `quality` object with `is_valid`, `is_anomaly`, `confidence_score`
- `processing` object with `raw_value`, `calibration_offset`, `ingested_at`

## Do Not

- ❌ Import from these files
- ❌ Use these models in new code
- ❌ Create new documents with these schemas

## Removal Timeline

These files may be permanently deleted in a future release. They are excluded from TypeScript compilation via `tsconfig.json`.
