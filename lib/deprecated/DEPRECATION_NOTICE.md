# ⚠️ DEPRECATED - Migration Utilities

**Status:** DEPRECATED as of December 31, 2025

## Important Notice

These migration utilities were used during the v1 → v2 data migration and are no longer needed. They are preserved here for historical reference only.

## Contents

### dual-write-adapter.ts
Used during the transition period to write data to both v1 and v2 collections simultaneously. This ensured data consistency while the migration was in progress.

### v1-to-v2-mapper.ts
Transform functions to convert v1 schema documents to v2 format. Used by the dual-write adapter and backfill scripts.

## Migration Complete

The migration from v1 to v2 has been completed:

- ✅ All v1 data has been backfilled to v2 collections
- ✅ All components now use v2 API exclusively
- ✅ Dual-write is no longer active
- ✅ v2 collections are the source of truth

## Collections Status

| Collection | Status |
|------------|--------|
| `devices` (v1) | Deprecated - read-only archive |
| `readings` (v1) | Deprecated - will TTL expire (7-day) |
| `devices_v2` | Active - production |
| `readings_v2` | Active - production (90-day TTL) |

## Do Not

- ❌ Import from these files
- ❌ Enable dual-write mode
- ❌ Run migration scripts again

## Removal Timeline

These files may be permanently deleted in a future release. They are excluded from TypeScript compilation via `tsconfig.json`.
