## Plan: Production-Ready Model & System Enhancement

**Objective:** Transform current Mongoose models and associated API routes to be production-ready with robust validation, error handling, audit trails, security, and comprehensive monitoring capabilities using an **Expand-Contract Migration Strategy**.

---

### Migration Strategy

**Approach:** Expand-Contract Pattern with Parallel Collections
- Create new `devices_v2` and `readings_v2` collections with enhanced schemas
- Build `/api/v2` endpoints that use the new collections
- Optionally implement dual-write adapter to sync v1 → v2 during transition
- Update dashboard to consume `/api/v2` endpoints
- Once stable, deprecate v1 and migrate remaining data
- Add authentication/authorization last

**Key Benefits:**
- Zero downtime migration
- Easy rollback capability
- Gradual validation of new schema
- No breaking changes to existing v1 API until ready

**Decision Context:**
- Using default values: `null` for numbers, `"unknown"` for strings during transition
- System identifier: `"sys-migration-agent"` for audit trails
- Data retention: 90 days for readings
- Rate limiting: By IP address AND device ID (Redis-based)
- Caching: Redis for metadata and device configs
- API versioning: URL path (`/api/v1/`, `/api/v2/`)

---

### Context

**Entry Points:**
* **V1 Models:** `models/Device.ts`, `models/Reading.ts`
* **V2 Models (New):** `models/v2/DeviceV2.ts`, `models/v2/ReadingV2.ts`
* **V1 API Routes:** `app/api/devices/`, `app/api/readings/`, `app/api/analytics/`, etc.
* **V2 API Routes (New):** `app/api/v2/*`
* **Dashboard Components:** `app/page.tsx`, `components/DeviceGrid.tsx`, `components/FloorPlan.tsx`, `components/AnomalyChart.tsx`

**Key Dependencies:** 
* Mongoose (ODM)
* Next.js API Routes
* Pusher (real-time)
* React/TypeScript (frontend)
* Zod (validation)
* Redis (rate limiting & caching - to be added)

**Current State Analysis:**
- ❌ No input validation library (Zod available but not used)
- ❌ No audit trails or change history
- ❌ Basic error handling (generic catch blocks)
- ❌ No request rate limiting or API security
- ❌ No health metrics or observability fields
- ❌ Limited device metadata (no manufacturer, model, firmware)
- ❌ No data retention policies beyond TTL
- ❌ No API versioning
- ❌ No authentication/authorization
- ❌ Missing indexes for query optimization
- ❌ No soft deletes
- ❌ No data integrity constraints beyond basic required fields

---

### Execution Steps

#### **Phase 1: V2 Models & Foundation (Expand)**

**1.1 Add Zod Validation Schemas**
- Create `/lib/validations/v2/device.validation.ts` with comprehensive Zod schemas for Device operations (create, update, query params)
- Create `/lib/validations/v2/reading.validation.ts` with Zod schemas for Reading operations
- Create `/lib/validations/common.validation.ts` for shared validation utilities (pagination, date ranges, sort orders)

**1.2 Create Enhanced Device Model V2 (models/v2/DeviceV2.ts)**
Create new model with collection name `devices_v2`:
Add production-ready fields:
```typescript
{
  // New Identification & Metadata
  serial_number: string (unique, indexed)
  manufacturer: string
  model: string
  firmware_version: string
  
  // Enhanced Configuration
  configuration: {
    threshold_warning: number
    threshold_critical: number
    sampling_interval: number (seconds)
    calibration_date: Date
    calibration_offset: number
  }
  
  // Location Enhancement
  location: {
    building_id: string
    floor: number
    room_name: string
    coordinates?: { x: number, y: number, z: number }
    zone?: string
  }
  
  // Operational Metadata
  metadata: {
    tags: string[]
    department: string
    cost_center?: string
    warranty_expiry?: Date
    last_maintenance?: Date
    next_maintenance?: Date
  }
  
  // Audit Trail
  audit: {
    created_at: Date
    created_by: string
    updated_at: Date
    updated_by: string
    deleted_at?: Date (soft delete)
    deleted_by?: string
  }
  
  // Health & Monitoring
  health: {
    last_seen: Date
    uptime_percentage: number (calculated)
    error_count: number
    last_error?: { timestamp: Date, message: string, code: string }
    battery_level?: number (for battery-powered devices)
    signal_strength?: number
  }
  
  // Status Enhancement
  status: 'active' | 'maintenance' | 'offline' | 'decommissioned' | 'error'
  status_reason?: string
  
  // Compliance & Security
  compliance: {
    requires_encryption: boolean
    data_classification: 'public' | 'internal' | 'confidential' | 'restricted'
    retention_days: number
  }
}
```

**1.3 Create Enhanced Reading Model V2 (models/v2/ReadingV2.ts)**
Create new model with collection name `readings_v2`:
```typescript
const ReadingV2Schema = new Schema(
  {
    // ---------------------------------------------------------
    // 1. METADATA (The "Bucketing" Key)
    // Keep this LOW CARDINALITY (values that repeat often)
    // ---------------------------------------------------------
    metadata: {
      device_id: { type: String, required: true }, // Links to DeviceV2
      
      // The "Link" to Device Capabilities
      // e.g., 'temperature', 'humidity', 'co2'
      type: { type: String, required: true }, 
      
      // CRITICAL ADDITION: Units
      // e.g., 'celsius', 'percent', 'ppm', 'volts'
      unit: { type: String, required: true },
      
      // Keep source here if it doesn't change per-reading
      source: { 
        type: String, 
        enum: ['sensor', 'simulation', 'manual', 'calibration'],
        default: 'sensor'
      }
    },

    // ---------------------------------------------------------
    // 2. MEASUREMENT (The Actual Data)
    // ---------------------------------------------------------
    timestamp: { type: Date, required: true },
    value: { type: Number, required: true },

    // ---------------------------------------------------------
    // 3. QUALITY & TRUST (New)
    // ---------------------------------------------------------
    quality: {
      is_valid: { type: Boolean, default: true },
      confidence_score: { type: Number, min: 0, max: 1 },
      
      // Store flags only if they exist to save space
      validation_flags: [String], 
      
      is_anomaly: { type: Boolean, default: false },
      anomaly_score: Number
    },

    // ---------------------------------------------------------
    // 4. CONTEXT (Optimized)
    // ---------------------------------------------------------
    context: {
      battery_level: Number, 
      signal_strength: Number, 
      ambient_temp: Number 
    },

    // ---------------------------------------------------------
    // 5. AUDIT (Lightweight)
    // ---------------------------------------------------------
    processing: {
      raw_value: Number, // The uncalibrated value
      calibration_offset: Number,
      ingested_at: Date
    }
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'seconds',
    },
    // 90 Days (in seconds)
    expireAfterSeconds: 7776000, 
  }
);
```

**1.4 Add Database Indexes for V2 Collections**
Create `/scripts/v2/create-indexes-v2.ts`:
- DeviceV2: `serial_number` (unique), `building_id + floor`, `status`, `health.last_seen`, `audit.deleted_at`
- ReadingV2: `metadata.device_id + timestamp`, `quality.is_anomaly`, `metadata.source`

**1.5 Create V2 Type Definitions**
- Create `/types/v2/device.types.ts` for DeviceV2 TypeScript interfaces
- Create `/types/v2/reading.types.ts` for ReadingV2 TypeScript interfaces
- Create `/types/v2/api.types.ts` for V2 API request/response types
- Keep existing v1 types unchanged

**1.6 Create Migration Utilities (Optional)**
- Create `/lib/migration/dual-write-adapter.ts` - Write to both v1 and v2 collections during transition
- Create `/lib/migration/v1-to-v2-mapper.ts` - Map v1 documents to v2 schema with defaults
- Create `/scripts/v2/backfill-v2.ts` - One-time migration script from v1 to v2 collections

---

#### **Phase 2: Error Handling & Utilities (Shared Infrastructure)**

**2.1 Create Centralized Error Handler**
- Create `/lib/errors/ApiError.ts` - Custom error class with status codes, error codes, and metadata
- Create `/lib/errors/errorHandler.ts` - Centralized error handling middleware for API routes
- Create `/lib/errors/errorCodes.ts` - Enum of application error codes (DEVICE_NOT_FOUND, INVALID_READING, etc.)

**2.2 Create Response Utilities**
- Create `/lib/api/response.ts` - Standardized API response formatters (success, error, paginated)
- Create `/lib/api/pagination.ts` - Pagination utilities with cursor and offset support
- Create `/lib/api/queryBuilder.ts` - Safe query builder for filtering and sorting

**2.3 Create Validation Utilities**
- Create `/lib/validations/validator.ts` - Zod validation wrapper with error formatting
- Create `/lib/validations/sanitizer.ts` - Input sanitization utilities

---

#### **Phase 3: V2 API Routes (New Endpoints)**

**Note:** V1 API routes remain unchanged and operational. All v2 routes consume from `devices_v2` and `readings_v2` collections.

**3.1 Create `/app/api/v2/devices/route.ts`**
Implement:
- `GET`: List devices with pagination (cursor/offset), enhanced filtering (by tags, department, health status, manufacturer), field projection, include/exclude soft-deleted
- `POST`: Create device in `devices_v2` with full Zod validation, audit trail creation (created_by: "sys-migration-agent"), uniqueness checks (serial_number), default values for new fields
- Input validation using Zod schemas from Phase 1.1
- Structured error responses with error codes
- Query optimization with lean() and select()
- Rate limiting by IP and device ID (Redis-based)
- Response format: `{ success: true, data: [...], pagination: {...} }`

**3.2 Create `/app/api/v2/devices/[id]/route.ts`**
Implement:
- `GET`: Retrieve single device from `devices_v2` with health stats, recent readings summary from `readings_v2`
- `PATCH`: Update device in `devices_v2` with audit trail (updated_by: "sys-migration-agent"), validate status transitions, optimistic locking
- `DELETE`: Soft delete with audit trail (deleted_at, deleted_by)
- Include validation for all mutations
- Return 404 with proper error code if device not found

**3.3 Create `/app/api/v2/devices/[id]/history/route.ts`**
Implement:
- `GET`: Retrieve device audit history from `devices_v2`
- Filter by date range, action type (created, updated, deleted)
- Pagination support
- Return structured audit log entries

**3.4 Create `/app/api/v2/readings/route.ts`**
Implement:
- `GET`: Query readings from `readings_v2` with time range, device filter, pagination, quality filters (is_valid, is_anomaly)
- Add field projection (exclude heavy fields if not needed)
- Optimize aggregation pipeline with indexes from Phase 1.4
- Validate query params with Zod schemas

**3.5 Create `/app/api/v2/readings/ingest/route.ts`**
Implement:
- `POST`: Bulk insert readings into `readings_v2` with validation, quality scoring, deduplication
- Rate limiting by IP AND device_id (critical for malfunctioning sensors)
- Batch validation using Zod array schemas
- Idempotency key support (prevent duplicate ingests)
- Add `ingested_at` timestamp and `raw_value` tracking
- Return summary: `{ success: true, inserted: 100, rejected: 2, errors: [...] }`

**3.6 Create `/app/api/v2/readings/latest/route.ts`**
Implement:
- `GET`: Get latest readings from `readings_v2` for specified devices
- Add query parameters: device IDs array, types filter, include_invalid flag
- Add quality metrics aggregation (% valid readings, average confidence_score)
- Cache results in Redis with 10-second TTL
- Optimize with compound indexes

**3.7 Create `/app/api/v2/analytics/energy/route.ts`**
Implement:
- `GET`: Energy analytics from `readings_v2`
- Add granularity parameter (minute, hour, day)
- Add aggregation type (sum, avg, min, max, percentile)
- Add comparison periods (vs previous period, vs same period last week)
- Add quality filtering (exclude invalid readings where is_valid=false)
- Add device grouping (by floor, room, type, department from `devices_v2`)
- Optimize aggregation with proper indexes
- Consider caching for expensive aggregations

**3.8 Create `/app/api/v2/analytics/health/route.ts`**
Implement:
- `GET`: Device health dashboard endpoint using `devices_v2`
- Calculate uptime percentages (based on health.last_seen)
- Identify offline/error devices (status check)
- Battery level warnings (health.battery_level < threshold)
- Maintenance scheduling needs (metadata.next_maintenance approaching)
- Aggregated health metrics by floor/department/building

**3.9 Create `/app/api/v2/analytics/anomalies/route.ts`**
Implement:
- `GET`: Retrieve flagged anomalous readings from `readings_v2` where quality.is_anomaly=true
- Anomaly trends over time (count by time bucket)
- Device-specific anomaly patterns (group by metadata.device_id)
- Sort by quality.anomaly_score
- Alert generation data

**3.10 Create `/app/api/v2/metadata/route.ts`**
Implement:
- `GET`: Aggregated metadata from `devices_v2`
- List unique manufacturers, models, departments
- Device type statistics (count per type, status breakdown)
- Health statistics (% online, % in maintenance, % decommissioned)
- Building/floor hierarchy with device counts
- Cache in Redis with revalidation on device updates

**3.11 Create `/app/api/v2/audit/route.ts`**
Implement:
- `GET`: Query audit trail across all devices in `devices_v2`
- Filter by user (created_by, updated_by, deleted_by), action type, date range
- Support pagination for large audit logs
- Export functionality (json format)
- Compliance reporting helper

**3.12 Update `/app/api/cron/simulate/route.ts` (Optional)**
Optionally update to write to both v1 and v2:
- Keep writing to v1 collections (existing behavior)
- Add dual-write to v2 collections using `/lib/migration/dual-write-adapter.ts`
- Add audit metadata: source='simulation', created_by='sys-migration-agent'
- This allows testing v2 API with live simulated data

---

#### **Phase 4: Dashboard & Component Updates (Contract Phase)**

**Note:** Once v2 API is stable and tested, update frontend to consume `/api/v2` endpoints instead of `/api/v1`.

**4.1 Update Frontend API Client**
- Create `/lib/api/v2-client.ts` - Type-safe API client for v2 endpoints
- Add TypeScript types from `/types/v2/` for request/response
- Add error handling with retry logic
- Add request caching for metadata endpoints

**4.2 Update `app/page.tsx`**
Changes:
- Switch from `/api/devices` to `/api/v2/devices`
- Switch from `/api/readings/latest` to `/api/v2/readings/latest`
- Add error boundary for graceful error handling
- Add loading states with skeletons
- Add error states with retry options
- Add health status indicator in header (% devices online from `/api/v2/analytics/health`)
- Add recent alerts/anomalies section (from `/api/v2/analytics/anomalies`)
- Add system health widget (new component)

**4.3 Update `components/DeviceGrid.tsx`**
Changes:
- Switch to `/api/v2/devices` with enhanced query params
- Add new columns: serial_number, manufacturer, model, health.last_seen
- Add health score indicator (color-coded based on status and health.uptime_percentage)
- Add battery level column (if health.battery_level exists)
- Add signal strength column (if health.signal_strength exists)
- Add actions menu: View history (`/api/v2/devices/[id]/history`), Edit configuration, Schedule maintenance, View audit log
- Add export filtered data functionality
- Add bulk actions: Update status, Add tags
- Add advanced filtering: By tags, department, health status, manufacturer, last seen
- Add column visibility toggle
- Add saved filter presets (localStorage)

**4.4 Update `components/FloorPlan.tsx`**
Changes:
- Switch to `/api/v2/devices` filtered by building_id and floor
- Add device health color-coding (based on status: active=green, maintenance=yellow, offline=gray, error=red)
- Add battery warnings visual indicator (health.battery_level < 20%)
- Add offline device highlighting (gray out where status='offline' or health.last_seen > 5 minutes ago)
- Add signal strength indicators on hover (if health.signal_strength exists)
- Add last seen timestamp on hover (health.last_seen)
- Add click handler to open device details modal
- Add filter toggle: Show only devices with issues (status='error' or is_anomaly or low battery)

**4.5 Update `components/AnomalyChart.tsx`**
Changes:
- Switch to `/api/v2/analytics/energy` with enhanced query params
- Add quality filtering toggle (exclude where quality.is_valid=false)
- Add anomaly markers on chart (overlay readings where quality.is_anomaly=true)
- Add anomaly score tooltips
- Add comparison period overlay (previous day/week via API query)
- Add granularity selector (minute, hour, day) - updates API query param
- Add aggregation type selector (avg, sum, max, min) - updates API query param
- Add device group selector (all, by floor, by room, by department) - updates API query param
- Add export chart data button (json/csv)
- Add data quality indicator footer (% valid readings from query response)

**4.6 Create `/components/DeviceHealthWidget.tsx`**
New component consuming `/api/v2/analytics/health`:
- System-wide health score calculation (% devices with status='active')
- Device status breakdown pie chart (group by status)
- Critical alerts count (status='error')
- Devices needing maintenance count (metadata.next_maintenance < 7 days)
- Offline devices list (status='offline' or health.last_seen > threshold)
- Battery warnings count (health.battery_level < 20%)
- Click handlers to filter main DeviceGrid

**4.7 Create `/components/DeviceDetailModal.tsx`**
New component:
- Full device information display from `/api/v2/devices/[id]`
- Configuration editor (PATCH to `/api/v2/devices/[id]`)
- Recent readings chart from `/api/v2/readings?device_id=[id]&limit=100`
- Health metrics history visualization
- Audit log viewer from `/api/v2/devices/[id]/history`
- Maintenance schedule display (metadata.last_maintenance, metadata.next_maintenance)
- Actions: Edit (opens config editor), Delete (soft delete), Schedule maintenance

**4.8 Create `/components/AlertsPanel.tsx`**
New component consuming `/api/v2/analytics/anomalies`:
- Recent anomalies list (quality.is_anomaly=true, sorted by timestamp desc)
- Critical threshold breaches (reading.value > device.configuration.threshold_critical)
- Device offline alerts (health.last_seen > 5 minutes)
- Battery warnings (health.battery_level < 20%)
- Maintenance due notifications (metadata.next_maintenance < today)
- Dismissible alerts (store in localStorage)
- Click to view device details

**4.9 Create `/components/AuditLogViewer.tsx`**
New component consuming `/api/v2/audit`:
- Filterable audit log table
- Filters: date range, user (created_by/updated_by/deleted_by), action type (created/updated/deleted)
- User actions tracking display
- Change history with visual diffs (before/after values)
- Export functionality (json)
- Pagination support
- Search by device, user, action type, date range

---

#### **Phase 5: Security, Performance & Monitoring**

**Note:** Security (especially auth) comes LAST after v2 is stable and dashboard is working.

**5.1 Add Rate Limiting (Priority: HIGH)**
- Create `/lib/ratelimit/limiter.ts` using Redis with sliding window algorithm
- **CRITICAL:** Rate limit by IP Address (for DDoS protection) AND Device ID (for malfunctioning sensors)
- Apply to `/api/v2/readings/ingest` (most critical - prevent runaway sensors)
- Apply to all v2 mutation endpoints (POST, PATCH, DELETE)
- Return 429 responses with retry-after headers and rate limit info
- Configure different limits per endpoint type:
  - `/readings/ingest`: 1000 requests/minute per device, 10000/minute per IP
  - Other mutations: 100 requests/minute per IP

**5.2 Add Caching Layer (Priority: HIGH)**
- Set up Redis for caching (or in-memory cache for development)
- Cache device configurations from `devices_v2` (helps speed up ingestion validation)
- Cache `/api/v2/metadata` responses (10-minute TTL)
- Cache `/api/v2/analytics/health` responses (30-second TTL)
- Add cache invalidation on device updates (PATCH/DELETE)
- Add cache warming for frequently accessed devices

**5.3 Add Monitoring & Observability (Priority: MEDIUM)**
- Create `/lib/monitoring/logger.ts` - Structured logging with levels (debug, info, warn, error)
- Create `/lib/monitoring/metrics.ts` - Track ingestion rates, API latency, error rates
- Add request tracing IDs to all API requests
- Add performance monitoring to slow queries (log queries > 1 second)
- Integrate Sentry for error tracking (optional, configurable via env var)
- Set up Prometheus/Grafana metrics export (optional, for production)
- Log all validation failures with context

**5.4 Optimize Database Queries (Priority: MEDIUM)**
- Ensure all indexes from Phase 1.4 are created and used
- Implement connection pooling optimization (adjust pool size based on load)
- Add query timeout configurations (30 seconds max)
- Use `lean()` for read-only operations (faster, no Mongoose document overhead)
- Add `explain()` analysis for complex aggregations in `/api/v2/analytics/*`
- Consider read replicas for analytics queries (future optimization)

**5.5 Add Data Migration & Backfill Scripts (Priority: MEDIUM)**
- Create `/scripts/v2/migrate-devices-v1-to-v2.ts` - One-time migration from `devices` to `devices_v2`
  - Map v1 fields to v2 fields
  - Set defaults: manufacturer="unknown", serial_number=device._id.toString(), etc.
  - Set audit fields: created_by="sys-migration-agent", created_at=original timestamp
- Create `/scripts/v2/migrate-readings-v1-to-v2.ts` - Backfill readings (only last 7 days due to TTL)
  - Map v1 readings to v2 schema
  - Set defaults: quality.is_valid=true, quality.confidence_score=0.95 (assuming valid)
  - Set metadata.unit based on metadata.type (e.g., temperature → celsius)
- Create `/scripts/v2/rollback-v2-to-v1.ts` - Emergency rollback capability
  - Drop `devices_v2` and `readings_v2` collections
  - Revert dashboard to use `/api/v1` endpoints
- Create `/scripts/v2/sync-check.ts` - Compare record counts between v1 and v2 for validation

**5.6 Add API Authentication/Authorization (Priority: LOW - LAST PHASE)**
- Create `/lib/auth/middleware.ts` - API key validation (stored in env vars or database)
- Create `/lib/auth/permissions.ts` - Role-based access control (RBAC)
  - Roles: admin (full access), operator (read + device updates), viewer (read only)
- Add authentication to all v2 mutation endpoints (POST, PATCH, DELETE)
- Add user context to audit trails (replace "sys-migration-agent" with actual user)
- Implement API key rotation mechanism
- Add rate limiting per API key (in addition to IP/device limits)
- Document authentication in `/docs/api-v2.md`

**5.7 Add Request Validation Middleware (Priority: MEDIUM)**
- Create `/lib/middleware/validateRequest.ts` - Automatic Zod validation wrapper
- Sanitize string inputs to prevent NoSQL injection (escape special characters)
- Add request body size limits (10MB max for bulk inserts, 1MB for others)
- Add query parameter whitelisting (reject unexpected params)
- Add header validation (require Content-Type: application/json for POST/PATCH)

---

#### **Phase 6: Testing, Documentation & Cleanup**

**6.1 Create API Documentation**
- Create `/docs/api-v2.md` - Complete V2 API documentation
  - Document all endpoints with request/response examples
  - Document query parameters and filters
  - Document error codes and meanings
  - Document rate limits (by IP, by device, by API key)
  - Document pagination (cursor vs offset)
  - Document authentication requirements (after Phase 5.6)
  - Include cURL examples for each endpoint
- Create `/docs/api-v1-to-v2-migration.md` - Migration guide for existing v1 API users
  - Field mapping changes
  - New required fields and defaults
  - Breaking changes
  - Deprecation timeline for v1

**6.2 Create Data Model Documentation**
- Create `/docs/models-v2.md` - Complete V2 schema documentation
  - Full field descriptions for DeviceV2 and ReadingV2
  - Field constraints (required, optional, defaults)
  - Validation rules (Zod schemas)
  - Index strategy explanation (why each index exists)
  - Data retention policies (90 days for readings)
  - Differences from v1 models

**6.3 Create Environment Configuration Documentation**
- Update `/docs/environment.md` - All required environment variables
  - Add Redis connection string (REDIS_URL)
  - Add rate limiting configuration (RATE_LIMIT_ENABLED, RATE_LIMIT_MAX_REQUESTS)
  - Add caching configuration (CACHE_ENABLED, CACHE_TTL)
  - Add monitoring configuration (SENTRY_DSN, ENABLE_METRICS)
  - Add API authentication keys (API_KEYS - comma-separated)
  - Security best practices (key rotation, secret management)
  - Production deployment checklist

**6.4 Create Testing Documentation**
- Create `/docs/testing-v2.md` - Testing strategy and examples
  - Unit testing examples for Zod schemas
  - Integration testing examples for v2 API endpoints
  - Load testing strategy for `/readings/ingest`
  - Migration testing checklist (verify v1 → v2 data integrity)
  - Rollback testing procedure

**6.5 Create Runbook**
- Create `/docs/runbook.md` - Operational procedures
  - How to monitor v2 API health
  - How to check migration progress
  - How to perform rollback if needed
  - How to clear Redis cache
  - How to investigate rate limiting issues (device vs IP)
  - How to rotate API keys
  - Common troubleshooting scenarios

**6.6 Update README**
- Add v2 API overview section
- Add migration strategy explanation (Expand-Contract)
- Add production deployment guide (step-by-step)
- Add Redis setup instructions
- Add monitoring setup (Sentry, Prometheus)
- Add link to `/docs/` folder for detailed documentation

**6.7 Add Frontend Type Safety (Continuous)**
- Ensure all frontend API calls use typed responses from `/types/v2/`
- Add error handling to all API calls with structured error types
- Add loading and error states to all components
- Add retry logic for failed requests

---

### Execution Order & Dependencies

**NEW Critical Path (Expand-Contract Migration):**
1. **Phase 1 (Expand):** Create V2 Models & Validation → MUST complete first
   - 1.1: Zod validation schemas
   - 1.2: DeviceV2 model with `devices_v2` collection
   - 1.3: ReadingV2 model with `readings_v2` collection
   - 1.4: Create indexes on v2 collections
   - 1.5: TypeScript types for v2
   - 1.6: Migration utilities (optional dual-write adapter)

2. **Phase 2 (Shared Infrastructure):** Error Handling & Utilities → Required for API routes
   - 2.1: Centralized error handling
   - 2.2: Response utilities
   - 2.3: Validation utilities

3. **Phase 3 (Expand):** Create V2 API Routes → Depends on Phase 1 & 2
   - 3.1-3.11: All v2 API endpoints (parallel work after foundation)
   - 3.12: Optional dual-write in simulation endpoint
   - **Milestone:** V2 API is operational, v1 API still running

4. **Phase 4 (Contract):** Update Dashboard → Depends on Phase 3
   - 4.1: Create v2 API client
   - 4.2-4.5: Update existing components to use v2 endpoints
   - 4.6-4.9: Create new components (health widget, detail modal, alerts, audit log)
   - **Milestone:** Dashboard fully on v2, v1 API can be deprecated

5. **Phase 5 (Harden):** Security & Performance → Can start after Phase 3, parallel with Phase 4
   - 5.1: Rate limiting (HIGH priority - do early)
   - 5.2: Caching layer (HIGH priority - do early)
   - 5.3: Monitoring & observability (MEDIUM priority)
   - 5.4: Database query optimization (MEDIUM priority)
   - 5.5: Migration & backfill scripts (MEDIUM priority)
   - 5.6: **Authentication/Authorization (LOW priority - LAST)**
   - 5.7: Request validation middleware (MEDIUM priority)

6. **Phase 6 (Document):** Testing & Documentation → Throughout all phases
   - 6.1-6.6: Documentation (can write in parallel as features complete)
   - 6.7: Frontend type safety (continuous)
   - **Milestone:** Production-ready system with full documentation

**Parallel Work Opportunities:**
- Phase 1.6 (migration utilities) can be built while Phase 2 is in progress
- Phase 2 (all sub-tasks) can be developed in parallel
- Phase 3: Individual v2 API routes can be built in parallel after 3.1-3.2 are done (foundation)
- Phase 4: Components can be updated in parallel after 4.1 (v2 client) is ready
- Phase 5: Tasks 5.1-5.4 and 5.7 can be done in parallel; 5.6 (auth) comes last
- Phase 6: Documentation can be written incrementally as each phase completes

**Critical Dependencies:**
- Phase 3 BLOCKS Phase 4 (can't update dashboard until v2 API exists)
- Phase 1 & 2 BLOCK Phase 3 (can't build API without models and utilities)
- Phase 5.6 (auth) should wait until Phase 4 is complete and stable

---

### Resolved Decisions (from user_decisions.md)

**✅ Authentication:** OAuth 2.0 for users, API keys for services (Phase 5.6 - LAST)

**✅ Rate Limiting:** Redis-based, by IP Address AND Device ID (Phase 5.1 - HIGH priority)

**✅ Caching:** Redis for metadata and device configs (Phase 5.2 - HIGH priority)

**✅ Monitoring:** Sentry for errors, Prometheus/Grafana for metrics (Phase 5.3 - MEDIUM priority)

**✅ Data Encryption:** Not required currently (no changes needed)

**✅ API Versioning:** URL path versioning `/api/v1/`, `/api/v2/` (implemented in Phase 3)

**✅ Data Retention:** 90 days for readings (already in model)

**✅ Audit Context:** System identifier: `"sys-migration-agent"` until auth is added (Phase 1.2)

**✅ Migration Strategy:** Expand-Contract with parallel collections `devices_v2`, `readings_v2` (Phase 1)

**✅ Default Values:** `null` for numbers, `"unknown"` for strings during transition (Phase 1.2-1.3)

---

### Remaining Risks & Mitigation

**Data Migration Risks:**
- ❌ **Risk:** Existing v1 data may not have values for new required fields
  - ✅ **Mitigation:** Use default values (`null`, `"unknown"`) and create migration script (Phase 5.5)
- ❌ **Risk:** TTL on readings means only last 90 days can be migrated
  - ✅ **Mitigation:** Accepted limitation, document in migration guide (Phase 6.1)
- ❌ **Risk:** Large datasets may cause migration downtime
  - ✅ **Mitigation:** Expand-Contract strategy allows zero-downtime migration (Phase 1-4)

**Performance Concerns:**
- ❌ **Risk:** Enhanced models increase document size
  - ✅ **Mitigation:** Monitor storage, use lean() queries, add indexes (Phase 5.4)
- ❌ **Risk:** Additional indexes slow writes
  - ✅ **Mitigation:** Benchmark write performance, tune index strategy if needed (Phase 5.4)
- ❌ **Risk:** Audit trails on readings are storage-intensive
  - ✅ **Mitigation:** Lightweight audit in `processing` field, full audit only on devices (Phase 1.3)

**Infrastructure Requirements:**
- ❌ **Risk:** Redis required for rate limiting and caching
  - ✅ **Mitigation:** Document Redis setup, provide docker-compose for local dev (Phase 6.3)
- ❌ **Risk:** Monitoring services (Sentry, Prometheus) have costs
  - ✅ **Mitigation:** Make optional via env vars, provide configuration guide (Phase 5.3, 6.3)

**Rollback Capability:**
- ❌ **Risk:** What if v2 has critical bugs after dashboard migration?
  - ✅ **Mitigation:** Keep v1 API operational until v2 is stable, create rollback script (Phase 5.5)
  - ✅ **Mitigation:** Dashboard can revert to v1 endpoints with minimal code changes (Phase 4.1)

---

### Success Criteria

Upon completion, the system will have:

**Phase 1-2 Completion:**
- ✅ V2 models (`devices_v2`, `readings_v2`) with enhanced schemas
- ✅ 100% input validation with Zod schemas
- ✅ TypeScript types for type-safe development
- ✅ Optimized database indexes on v2 collections
- ✅ Centralized error handling and response utilities

**Phase 3 Completion:**
- ✅ Complete `/api/v2/` endpoint suite (devices, readings, analytics, metadata, audit)
- ✅ Structured error responses with meaningful error codes
- ✅ Enhanced device metadata (manufacturer, model, serial_number, health metrics)
- ✅ Reading quality scoring and anomaly detection
- ✅ Comprehensive audit trails for all mutations
- ✅ V1 API still operational (zero downtime)

**Phase 4 Completion:**
- ✅ Dashboard fully migrated to v2 API
- ✅ Enhanced UI with health monitoring, alerts panel, audit log viewer
- ✅ Type-safe frontend-backend integration
- ✅ Improved UX with advanced filtering, bulk actions, detail modals

**Phase 5 Completion:**
- ✅ Rate limiting by IP AND device ID (critical for sensor protection)
- ✅ Redis-based caching for metadata and device configs
- ✅ Production-ready monitoring (Sentry, Prometheus/Grafana)
- ✅ Optimized database queries with lean() and proper indexes
- ✅ Migration scripts for v1 → v2 data backfill
- ✅ API authentication and authorization (OAuth 2.0 + API keys)
- ✅ Request validation and sanitization middleware

**Phase 6 Completion:**
- ✅ Comprehensive API documentation (`/docs/api-v2.md`)
- ✅ Data model documentation (`/docs/models-v2.md`)
- ✅ Migration guide (`/docs/api-v1-to-v2-migration.md`)
- ✅ Operational runbook (`/docs/runbook.md`)
- ✅ Environment configuration guide (`/docs/environment.md`)
- ✅ Updated README with v2 overview and deployment guide

**Final System State:**
- ✅ Soft delete capabilities with data recovery
- ✅ 90-day data retention with TTL
- ✅ Production-ready with rollback capability
- ✅ Fully documented and maintainable
- ✅ Secure, performant, and observable