# V1 Deprecation Implementation Plan

## Context
- **Goal:** Complete the migration from v1 to v2 API by moving all deprecated files to designated folders and ensuring no active code references v1 APIs.
- **Architecture:** The v2 API is now production-ready. All v1 APIs, models, and migration utilities should be archived. Components still using v1 fallbacks must be updated.

---

## Pre-Deprecation Audit Results

### ⚠️ BLOCKERS: Components Still Using V1 Endpoints

The following components have v1 API fallbacks that **must be removed** before deprecation:

| Component | File | V1 Usage | Line |
|-----------|------|----------|------|
| DeviceGrid | `components/DeviceGrid.tsx` | `fetch('/api/devices')` (fallback) | ~137 |
| DeviceGrid | `components/DeviceGrid.tsx` | `fetch('/api/readings/latest')` | ~152 |
| FloorPlan | `components/FloorPlan.tsx` | `fetch('/api/devices')` (fallback) | ~81 |

### V1 API Routes to Deprecate

| Route | Path | Status |
|-------|------|--------|
| Devices | `app/api/devices/route.ts` | To deprecate |
| Readings Latest | `app/api/readings/latest/route.ts` | To deprecate |
| Metadata | `app/api/metadata/route.ts` | To deprecate |
| Analytics Energy | `app/api/analytics/energy/route.ts` | To deprecate |
| Cron Simulate | `app/api/cron/simulate/route.ts` | Uses v1 models - needs update or deprecation |

### V1 Models to Deprecate

| Model | Path | Status |
|-------|------|--------|
| Device | `models/Device.ts` | To deprecate |
| Reading | `models/Reading.ts` | To deprecate |

### Migration Utilities to Deprecate

| File | Path | Status |
|------|------|--------|
| Dual-Write Adapter | `lib/migration/dual-write-adapter.ts` | To deprecate |
| V1 to V2 Mapper | `lib/migration/v1-to-v2-mapper.ts` | To deprecate |

### Lib Files to KEEP (Used by V2)

| File/Folder | Usage |
|-------------|-------|
| `lib/db.ts` | Database connection (shared) |
| `lib/pusher.ts` | Pusher server (shared) |
| `lib/pusher-client.ts` | Pusher client (shared) |
| `lib/utils.ts` | Utility functions (`cn()`) used by UI components |
| `lib/api/` | All files used by v2 routes |
| `lib/errors/` | Error handling used by v2 |
| `lib/validations/` | Validation utilities used by v2 |
| `lib/utils/correlation.ts` | Used by v2 temperature-correlation API |
| `lib/utils/severity.ts` | Used by v2 components |

---

## Step-by-Step Instructions

### Phase 1: Fix Blocking Components (Required Before Deprecation)

1. [x] **Update DeviceGrid to use v2 readings API**
   - *File:* `components/DeviceGrid.tsx`
   - *Action:* Remove v1 fallback at line ~137, update readings fetch at line ~152 to use `/api/v2/readings/latest` or `v2Api.readings.latest()`
   - *Detail:* The devices fetch already uses `v2Api.devices.list()`. Only the readings fetch and fallback need updating.
   - ✅ **DONE:** Removed v1 fallback, updated to use `v2Api.readings.latest()` with comma-separated device_ids

2. [x] **Update FloorPlan to remove v1 fallback**
   - *File:* `components/FloorPlan.tsx`
   - *Action:* Remove the v1 fallback at line ~81. The component already uses v2 API for primary fetch.
   - *Detail:* FloorPlan already uses v2 for readings (line ~93+). Only the device fallback needs removal.
   - ✅ **DONE:** Removed v1 fallback from devices fetch

3. [x] **Update cron simulate route to use v2 models**
   - *File:* `app/api/cron/simulate/route.ts`
   - *Action:* Replace imports of `Device` and `Reading` with `DeviceV2` and `ReadingV2`
   - *Constraint:* Update the reading creation to match v2 schema (with `quality`, `context`, `processing` fields)
   - ✅ **DONE:** Updated to use DeviceV2/ReadingV2 with proper v2 schema including quality, processing, and deviceTypeToUnit mapping

### Phase 2: Create Deprecated Folders

4. [x] **Create deprecated folder for v1 API routes**
   - *Action:* Create directory `app/api/_v1-deprecated/` (underscore prefix so Next.js ignores it)
   - ✅ **DONE**

5. [x] **Create deprecated folder for v1 models**
   - *Action:* Create directory `models/v1 (deprecated)/`
   - ✅ **DONE**

6. [x] **Create deprecated folder in lib for migration utilities**
   - *Action:* Create directory `lib/deprecated/`
   - ✅ **DONE**

### Phase 3: Move Deprecated API Routes

7. [x] **Move v1 devices route**
   - *To:* `app/api/_v1-deprecated/devices/`
   - ✅ **DONE**

8. [x] **Move v1 readings route**
   - *To:* `app/api/_v1-deprecated/readings/`
   - ✅ **DONE**

9. [x] **Move v1 metadata route**
   - *To:* `app/api/_v1-deprecated/metadata/`
   - ✅ **DONE**

10. [x] **Move v1 analytics routes**
    - *To:* `app/api/_v1-deprecated/analytics/`
    - ✅ **DONE**

11. [x] **Move cron simulate route**
    - *To:* `app/api/_v1-deprecated/cron/`
    - ✅ **DONE** (was updated to use v2 models before moving)

### Phase 4: Move Deprecated Models

12. [x] **Move v1 Device model**
    - *To:* `models/v1 (deprecated)/Device.ts`
    - ✅ **DONE**

13. [x] **Move v1 Reading model**
    - *To:* `models/v1 (deprecated)/Reading.ts`
    - ✅ **DONE**

### Phase 5: Move Migration Utilities

14. [x] **Move entire migration folder to deprecated**
    - *To:* `lib/deprecated/migration/`
    - ✅ **DONE**

### Phase 6: Update Imports in Deprecated Files

15. [x] **Skip - files are excluded from TypeScript compilation**
    - Deprecated files are excluded via `tsconfig.json` so import errors don't block build
    - ✅ **SKIPPED** (not needed since excluded from compilation)

16. [x] **Skip - files are excluded from TypeScript compilation**
    - ✅ **SKIPPED** (not needed since excluded from compilation)

### Phase 7: Update Documentation

17. [x] **Update copilot-instructions.md**
    - *File:* `.github/copilot-instructions.md`
    - *Action:* Remove references to v1 API, dual-write, and migration utilities
    - *Detail:* Update project structure section to reflect new organization
    - ✅ **DONE:** Updated all sections to reflect v2-only architecture

18. [x] **Create DEPRECATION_NOTICE.md in deprecated folders**
    - *Files:* 
      - `app/api/_v1-deprecated/DEPRECATION_NOTICE.md` ✅
      - `models/v1 (deprecated)/DEPRECATION_NOTICE.md` ✅
      - `lib/deprecated/DEPRECATION_NOTICE.md` ✅
    - ✅ **DONE**

### Phase 8: Cleanup Workflow

19. [x] **Update GitHub workflow for simulation**
    - *File:* `.github/workflows/simulate-data.yml`
    - *Action:* Updated endpoint from `/api/cron/simulate` to `/api/v2/cron/simulate`
    - ✅ **DONE:** Created new v2 cron simulate endpoint and updated workflow

### Additional Changes Made

20. [x] **Move DeviceGrid.v1.backup.tsx to deprecated**
    - *To:* `components/_deprecated/DeviceGrid.v1.backup.tsx`
    - ✅ **DONE**

21. [x] **Update tsconfig.json to exclude all deprecated folders**
    - Added: `scripts/v1 (deprecated)`, `app/api/_v1-deprecated`, `models/v1 (deprecated)`, `lib/deprecated`, `components/_deprecated`
    - ✅ **DONE**

---

## Verification Checklist

After completing all steps, verify:

- [x] `grep -r "/api/devices" --include="*.tsx" --include="*.ts" app/ components/` returns no active usage ✅
- [x] `grep -r "/api/readings" --include="*.tsx" --include="*.ts" app/ components/` returns no active usage ✅
- [x] `grep -r "from.*models/Device" --include="*.ts"` only shows deprecated folders ✅
- [x] `grep -r "from.*models/Reading" --include="*.ts"` only shows deprecated folders ✅
- [x] `grep -r "dual-write" --include="*.ts"` only shows deprecated folders ✅
- [x] `pnpm build` completes successfully ✅
- [x] `pnpm dev` starts without errors
- [x] Dashboard loads and displays data correctly

---

## File Structure After Deprecation

```
app/api/
  _v1-deprecated/      # ← All v1 routes moved here (underscore prefix = ignored by Next.js)
    analytics/
    cron/
    devices/
    metadata/
    readings/
    DEPRECATION_NOTICE.md
  v2/                  # ← Production API (unchanged)
    analytics/
    audit/
    devices/
    metadata/
    readings/

models/
  v1 (deprecated)/     # ← V1 models moved here
    Device.ts
    Reading.ts
    DEPRECATION_NOTICE.md
  v2/                  # ← Production models (unchanged)
    DeviceV2.ts
    ReadingV2.ts
    index.ts

lib/
  api/                 # ← Keep (used by v2)
  errors/              # ← Keep (used by v2)
  validations/         # ← Keep (used by v2)
  utils/               # ← Keep (used by v2)
  deprecated/          # ← Migration utilities moved here
    migration/
      dual-write-adapter.ts
      v1-to-v2-mapper.ts
    DEPRECATION_NOTICE.md
  db.ts                # ← Keep (shared)
  pusher.ts            # ← Keep (shared)
  pusher-client.ts     # ← Keep (shared)
  utils.ts             # ← Keep (shared)

components/
  _deprecated/         # ← Backup components moved here
    DeviceGrid.v1.backup.tsx
```

---

## Rollback Plan

If issues arise after deprecation:

1. All deprecated files are preserved in `(deprecated)` folders
2. Imports can be reverted by updating paths
3. Git history preserves all changes for easy revert

---

## Notes

- The `scripts/v1 (deprecated)/` folder already exists and contains old scripts
- `DeviceGrid.v1.backup.tsx` is a backup file and can be deleted after verification
- The `plans/` folder contains documentation that references v1 - update as needed
