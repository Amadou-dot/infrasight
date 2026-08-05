# AI Coding Agent Instructions for Infrasight

## Project Overview

**Infrasight** is a real-time IoT sensor monitoring dashboard for building management, built with **Next.js 16** (Turbopack), **TypeScript**, **MongoDB** (Mongoose timeseries), and **Pusher** for real-time updates. It tracks environmental sensors across building floors and rooms.

## Critical Architecture Decisions

### V2 API (Production)

The migration from v1 to v2 is **complete**. All code now uses v2 exclusively:

- **V2 Collections**: `devices_v2`, `readings_v2` (enhanced with audit trails, health metrics, compliance, 7-day TTL), `schedules_v2` (maintenance scheduling), `alert_rules_v2` + `alerts_v2` (threshold-based alerting)
- **V2 API**: All endpoints under `/api/v2/`
- **V1 Deprecated**: All v1 files moved to `_deprecated` folders and excluded from TypeScript compilation

**Important**: Only use v2 models and APIs. V1 code exists only for historical reference.

### MongoDB Timeseries Collections

Readings use MongoDB timeseries with **critical constraints**:

- `timeField: 'timestamp'`, `metaField: 'metadata'`, `granularity: 'seconds'`
- `metadata` field is the bucketing key—keep **LOW CARDINALITY** (device_id, type, unit, source only)
- Cannot modify schema fields after creation without recreating collection
- TTL: 7 days (`expireAfterSeconds`)
- **15 Device/Reading Types**: temperature, humidity, occupancy, power, co2, pressure, light, motion, air_quality, water_flow, gas, vibration, voltage, current, energy
- **35 Reading Units**: Comprehensive unit support (celsius, fahrenheit, kelvin, percent, ppm, watts, volts, lux, etc.)

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
pnpm test:api           # Test v2 API endpoints
```

### Testing Commands

```bash
pnpm test               # Run all Jest tests
pnpm test:watch         # Jest watch mode
pnpm test:coverage      # Jest with coverage report
pnpm test:unit          # Unit tests only
pnpm test:integration   # Integration tests only
pnpm test:e2e           # Playwright E2E tests
pnpm test:e2e:ui        # Playwright UI mode
pnpm lint               # ESLint
```

### Required Environment Variables

All checked at import time—app fails loudly if missing:

- `MONGODB_URI`: Connection string
- `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`: Server-side real-time
- `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`: Client-side (must have `NEXT_PUBLIC_` prefix)

**Clerk Authentication (required):**

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: Clerk publishable key
- `CLERK_SECRET_KEY`: Clerk secret key
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`: Sign-in page URL (`/sign-in`)
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`: Sign-up page URL (`/sign-up`)
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`: Redirect after sign-in (`/`)
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`: Redirect after sign-up (`/`)

**RBAC Organization Access (required):**

- `CLERK_ALLOWED_ORG_SLUGS`: Comma-separated org slugs allowed access (default: `users`)
- `NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS`: Client-side org allowlist (default: `users`)

**Optional (Phase 5 Features):**

- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: Redis for caching and rate limiting
- `REDIS_URL`, `REDIS_TLS`: Alternative Redis configuration
- `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`: Error tracking with Sentry
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`: Sentry project configuration
- `ENABLE_METRICS`: Enable Prometheus metrics endpoint (true/false)
- `LOG_LEVEL`: Logging level (debug/info/warn/error)
- `RATE_LIMIT_ENABLED`: Enable rate limiting (true/false)
- `CACHE_ENABLED`, `CACHE_METADATA_TTL`, `CACHE_HEALTH_TTL`: Cache configuration
- `SEED_SECRET`: Secret token used by your external scheduler (for example, n8n) to authenticate the `/api/v2/cron/simulate` endpoint

**Optional (Alerting):**

- `ALERT_STALE_AFTER_SECONDS`: Seconds of silence after which the cron-path staleness sweep closes an open alert with `resolution: 'stale'` (default `1800` = 30 minutes; see [lib/alerting/sweep.ts](lib/alerting/sweep.ts)). Must be a positive integer — a malformed or non-positive value logs a warning and falls back to the default rather than silently disabling staleness detection. Read **once at module load**, so a change needs a restart.

**Optional (Public read-only demo):**

- `DEMO_MODE`, `NEXT_PUBLIC_DEMO_MODE`: When both are `"true"`, anonymous visitors may browse the app and read GET APIs without signing in. Writes stay blocked (the synthetic demo context carries `org:member`, and every mutation goes through `requireAdmin()`), and alert/alert-rule audit trails are redacted for demo readers by `redactAuditForDemo` ([lib/alerting/redact.ts](lib/alerting/redact.ts)). Leave unset for a normal private deployment.

**Testing:**

- `E2E_TESTING`: Set to `true` to bypass auth for E2E tests

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

const schedules = await v2Api.schedules.list({ status: 'scheduled' });
const reportBlob = await v2Api.reports.generateDeviceHealth({ scope: 'all' });
```

**Client namespaces**: `v2Api.devices`, `v2Api.readings`, `v2Api.analytics`, `v2Api.schedules`, `v2Api.reports`, `v2Api.metadata`, `v2Api.audit`, `v2Api.alerts`, `v2Api.alertRules`

Prefer this over raw `fetch()` for type safety.

### React Query Hooks

For React components, use the typed hooks in `lib/query/hooks/`:

```typescript
import { useDevicesList, useHealthAnalytics, useAnomalies } from '@/lib/query/hooks';

// In component
const { data: devices, isLoading, error } = useDevicesList({ status: 'active' });
const { data: health } = useHealthAnalytics();
const { data: anomalies } = useAnomalies({ minScore: 0.7 });
```

**Available Hooks:**

- `useDevicesList(params)` - List devices with filtering
- `useHealthAnalytics()` - Device health dashboard data
- `useEnergyAnalytics(params)` - Energy consumption analytics
- `useMaintenanceForecast()` - Predictive maintenance data
- `useMetadata()` - System metadata
- `useAnomalies(params)` - Anomaly detection results
- `useSchedulesList(filters)` - List maintenance schedules with filtering
- `useScheduleDetail(id, options)` - Single schedule detail
- `useCreateSchedule()` - Create schedule(s) mutation with auto-invalidation
- `useUpdateSchedule()` - Update schedule mutation
- `useCompleteSchedule()` - Mark schedule as completed
- `useCancelSchedule()` - Cancel schedule
- `useAlertsList(filters)` - List alerts with filtering
- `useAlertDetail(id, options)` - Single alert detail (optional: include device)
- `useOpenAlertCount()` - Count of open alerts, for the TopNav badge
- `useAcknowledgeAlert()` - Acknowledge an alert mutation
- `useResolveAlert()` - Resolve an alert mutation
- `useAlertRulesList(filters)` - List alert rules with filtering
- `useAlertRuleDetail(id)` - Single alert rule detail
- `useCreateAlertRule()` - Create alert rule mutation
- `useUpdateAlertRule()` - Update alert rule mutation
- `useDeleteAlertRule()` - Soft-delete alert rule mutation

Hooks handle caching, refetching, and error states automatically via React Query.

## V2 API Endpoints Reference

The v2 API provides 33 comprehensive endpoints organized into 9 categories:

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

### Maintenance Scheduling (5 endpoints)

- **GET /api/v2/schedules** - List schedules with pagination, filtering (status, service_type, device_id, date range)
- **POST /api/v2/schedules** - Create schedule(s) with bulk support (1-100 devices per request)
- **GET /api/v2/schedules/[id]** - Get single schedule (optional: include device details)
- **PATCH /api/v2/schedules/[id]** - Update schedule (reschedule, change status/notes)
- **DELETE /api/v2/schedules/[id]** - Cancel schedule (sets status to 'cancelled')

### Alerting (8 endpoints)

- **GET /api/v2/alerts** - List/filter alerts with pagination and sorting (never returns the internal `pending` status)
- **GET /api/v2/alerts/[id]** - Get single alert (optional: include device details)
- **PATCH /api/v2/alerts/[id]** - Acknowledge or resolve an alert
- **GET /api/v2/alert-rules** - List alert rules with pagination, filtering
- **POST /api/v2/alert-rules** - Create an alert rule
- **GET /api/v2/alert-rules/[id]** - Get single alert rule
- **PATCH /api/v2/alert-rules/[id]** - Update an alert rule
- **DELETE /api/v2/alert-rules/[id]** - Soft delete an alert rule

### Reports (1 endpoint)

- **GET /api/v2/reports/device-health** - Generate aggregate PDF report (all buildings or per-building scope)

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
  v2/DeviceV2.ts, ReadingV2.ts    # Production models (7-day TTL, audit trails)
  v2/ScheduleV2.ts                # Maintenance scheduling model (status machine, audit trails)
  v2/AlertRuleV2.ts, AlertV2.ts    # Threshold alerting models (alert_rules_v2, alerts_v2; 8 indexes total)
  v1 (deprecated)/                 # Archived v1 models (excluded from compilation)
lib/
  db.ts                            # Global cached connection (prevents hot-reload leak)
  validations/v2/                  # Zod schemas for all v2 operations
  validations/common.validation.ts # Shared validation helpers
  validations/validator.ts         # Validation utilities
  errors/                          # ApiError + error handling utilities
  api/
    v2-client.ts                   # Typed client for v2 endpoints
    response.ts, pagination.ts     # Response helpers and pagination utilities
  pusher.ts                        # Server-side Pusher configuration
  pusher-context.tsx               # Pusher React context provider (usePusherAlerts, usePusherReadings)
  alerting/                        # Alert rule evaluation, staleness sweep, Pusher notify, demo redaction
    evaluate.ts                    # Breach-aware evaluator, called by both write paths post-commit
    sweep.ts                       # Staleness sweep (device_inactive / stale auto-resolution)
    notify.ts                      # Bounded Pusher envelopes (publishAlertEvents)
    rule-cache.ts                  # 60s rule cache, bucketed by reading type
    selector.ts                    # Device selector matching + metric accessors
    redact.ts                      # Demo-mode audit actor redaction (redactAuditForDemo)
  query/                           # React Query integration
    hooks/                         # API hooks (useDevicesList, useSchedulesList, etc.)
    queryClient.ts                 # Query client configuration
    types.ts                       # React Query type definitions
  cache/                           # Redis caching with invalidation
  monitoring/                      # Sentry, Prometheus metrics, logging, tracing
  ratelimit/                       # Rate limiting config and middleware
  redis/                           # Redis client configuration
  middleware/                      # Request validation, body size, headers
  utils/                           # Correlation analysis, severity calculation
  auth/                            # RBAC utilities (requireAdmin, requireOrgMembership, useRbac)
app/
  layout.tsx                       # Root layout with ClerkProvider
  page.tsx                         # Dashboard home page
  not-found.tsx                    # 404 page
  global-error.tsx                 # Global error boundary
  settings/page.tsx                # User settings (theme, profile, sign-out)
  analytics/page.tsx               # Analytics dashboard
  devices/page.tsx                 # Device list view (+ Add Device modal for admins)
  devices/[id]/page.tsx            # Canonical, shareable device detail page
  devices/deleted/page.tsx         # Deleted devices (admin only)
  devices/_components/             # Colocated device page components
    DeviceCardSkeleton.tsx         # Loading skeleton for device cards
    DeviceFilterModal.tsx          # Device filter modal
    DeviceSearchBar.tsx            # Device search bar
    DeviceStatusCards.tsx          # Device status summary cards
    useDeviceFilterParams.ts       # Device list filter state, synced to the URL
  floor-plan/page.tsx              # Floor plan visualization
  maintenance/page.tsx             # Maintenance dashboard (+ scheduling)
  alerts/page.tsx                  # Alerts list view
  alerts/[id]/page.tsx             # Canonical, shareable alert detail page
  alerts/rules/page.tsx            # Alert rule management page (admin actions gated)
  unauthorized/page.tsx            # Unauthorized org membership page
  sign-in/[[...sign-in]]/page.tsx  # Clerk sign-in page
  sign-up/[[...sign-up]]/page.tsx  # Clerk sign-up page
  api/
    v2/                            # Production API routes (33 endpoints)
      devices/                     # Device CRUD + history
      readings/                    # Reading queries + ingest + latest
      analytics/                   # 5 analytics endpoints
      schedules/                   # Maintenance scheduling CRUD
      alerts/                      # Alert list/get + acknowledge/resolve
      alert-rules/                 # Alert rule CRUD (soft delete)
      reports/                     # PDF report generation
      audit/, metadata/, metrics/  # System endpoints
      cron/simulate/               # Synthetic data generator
    _v1-deprecated/                # Archived v1 routes (ignored by Next.js)
proxy.ts                           # Clerk middleware for route protection (Next.js 16 renamed middleware.ts to proxy.ts)
scripts/v2/                        # seed-v2, simulate, test-api, create-indexes, verify-indexes
components/                        # React components (all use 'use client')
  dashboard/                       # Dashboard-specific widgets
    ActiveAlertsWidget.tsx         # Open-alerts widget (built fresh, not lifted from AnomalyPanel)
    AnomalyDetectionChart.tsx      # Anomaly chart visualization
    CriticalIssuesPanel.tsx        # Critical issues panel
    MaintenanceWidget.tsx          # Maintenance summary widget
    StatCard.tsx                   # Stat card component
    SystemHealthWidget.tsx         # System health widget
  devices/CreateDeviceModal.tsx    # Device creation form (admin only)
  devices/DeviceDetailView.tsx     # Shared device detail presentation (modal + page)
  devices/useDeviceDetail.ts       # Shared device detail data loading
  devices/TagInput.tsx             # Tag input component for device metadata
  alerts/AlertDetailView.tsx       # Shared alert detail presentation (page)
  alerts/AlertList.tsx             # Paginated alert list with filters (/alerts)
  alerts/AlertRuleList.tsx         # Alert rule management list (/alerts/rules)
  alerts/AlertSeverityBadge.tsx    # Severity badge (info/warning/critical)
  alerts/AlertStatusBadge.tsx      # Status badge (firing/acknowledged/resolved)
  alerts/AlertToaster.tsx          # Real-time toast notifications for fired/resolved alerts
  alerts/CreateAlertRuleModal.tsx  # Alert rule creation form (admin only)
  alerts/useAlertFilterParams.ts   # Alert list filter state, synced to the URL
  AnomalyPanel.tsx                 # Anomaly alerts list (analytics page; renamed from AlertsPanel.tsx)
  AnomalyChart.tsx                 # Anomaly chart component
  AuditLogViewer.tsx               # Audit log viewer
  DeviceDetailModal.tsx            # Device detail modal (wraps DeviceDetailView)
  DeviceGrid.tsx                   # Device grid view
  DeviceHealthWidget.tsx           # Device health widget
  DeviceInventoryCard.tsx          # Device inventory card
  FloorPlan.tsx                    # Floor plan component
  MaintenanceForecastWidget.tsx    # Maintenance forecast widget
  MaintenanceStatusCards.tsx       # Maintenance status cards
  MaintenanceTimeline.tsx          # Maintenance timeline
  Pagination.tsx                   # Pagination component
  PrioritySummaryCards.tsx         # Priority summary cards
  ScheduleList.tsx                 # Paginated schedule list with filters
  ScheduleServiceModal.tsx         # Schedule creation modal (multi-device, bulk)
  ScheduleStatusBadge.tsx          # Status badge (scheduled/completed/cancelled)
  ServiceTypeBadge.tsx             # Service type badge (firmware/calibration/emergency/maintenance)
  GenerateReportModal.tsx          # PDF report generation modal
  TemperatureCorrelationPanel.tsx  # Temperature correlation panel
  TopNav.tsx                       # Top navigation bar
  clerk-theme-provider.tsx         # Clerk theme integration
  mode-toggle.tsx                  # Light/dark mode toggle
  theme-provider.tsx               # Theme provider wrapper
  user-button-with-theme.tsx       # Clerk UserButton with theme support
types/v2/                          # TypeScript types for v2 API contracts
  schedule.types.ts                # Schedule types (ServiceType, ScheduleStatus, etc.)
__tests__/                         # Jest test suites
  unit/                            # Unit tests (models, validations, auth, utils)
  integration/api/                 # API integration tests
e2e/                               # Playwright E2E tests
instrumentation.ts                 # Next.js instrumentation hook for Sentry
sentry.*.config.ts                 # Sentry configuration (client, server, edge)
playwright.config.ts               # Playwright E2E configuration
jest.config.js                     # Jest configuration
.github/workflows/
  test-coverage.yml                # CI test coverage workflow
```

## Phase 5: Security, Performance & Monitoring

The v2 API includes enterprise-grade features for production deployment:

### Rate Limiting

- **Implementation**: Upstash Redis-backed rate limiter
- **Default Limits**: 100 requests/minute for POST operations
- **Middleware**: `applyRateLimit()` in `lib/ratelimit/`
- **Endpoints**: Applied to device creation, reading ingestion, schedule mutations

### Caching Strategy

- **Cache Provider**: Redis with cache-aside pattern
- **TTL**: 10 minutes for metadata, configurable per endpoint
- **Invalidation**: Automatic cache invalidation on create/update/delete operations
- **Keys**: Structured cache keys in `lib/cache/keys.ts`
- **Endpoints**: Metadata, analytics aggregations

### Authentication & RBAC (Clerk)

- **Provider**: [Clerk](https://clerk.com) for user authentication and organization-based RBAC
- **Middleware**: `proxy.ts` protects all routes and validates organization membership
- **Components**: `UserButton` in TopNav, `useUser()` hook for user data
- **Routes**: `/sign-in`, `/sign-up` for authentication pages
- **Protected Routes**: All dashboard and API routes require sign-in and org membership
- **Public Routes**: Only `/api/v2/cron/simulate` is public (for external scheduler access)
- **API Auth Utilities**: `lib/auth/` provides RBAC helpers for API routes
- **Audit Tracking**: All mutation operations track the authenticated user's email in audit trails

**RBAC Roles:**

| Role | Permissions |
|------|-------------|
| `org:admin` | Full access: create, read, update, delete, ingest, view audit, access deleted devices |
| `org:member` | Read-only: view devices, readings, analytics, metadata (cannot modify) |

**Server-Side RBAC Functions** (from `lib/auth/`):

```typescript
import { requireOrgMembership, requireAdmin, getAuditUser, isAdminRole } from '@/lib/auth';

// For read-only endpoints (admins + members)
export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    const authContext = await requireOrgMembership();
    // authContext: { userId, user, orgId, orgSlug, orgRole }
    // ...
  });
}

// For write operations (admins only)
export async function POST(request: NextRequest) {
  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);
    // ...
  });
}
```

**Client-Side RBAC Hook** (for UI):

```typescript
import { useRbac } from '@/lib/auth/rbac-client';

function MyComponent() {
  const { isAdmin, isMember, orgRole, isLoaded } = useRbac();

  // Conditionally render admin-only features
  if (isAdmin) {
    return <DeleteButton />;
  }
}
```

**API Endpoint Permissions:**

| Endpoint | Method | Requirement |
|----------|--------|-------------|
| `/api/v2/devices` | GET | `requireOrgMembership()` |
| `/api/v2/devices` | POST | `requireAdmin()` |
| `/api/v2/devices/:id` | PATCH/DELETE | `requireAdmin()` |
| `/api/v2/devices/:id/history` | GET | `requireAdmin()` |
| `/api/v2/readings` | GET | `requireOrgMembership()` |
| `/api/v2/readings/ingest` | POST | `requireAdmin()` |
| `/api/v2/analytics/*` | GET | `requireOrgMembership()` |
| `/api/v2/audit` | GET | `requireAdmin()` |
| `/api/v2/metrics` | GET | `requireAdmin()` |
| `/api/v2/schedules` | GET | `requireOrgMembership()` |
| `/api/v2/schedules` | POST | `requireAdmin()` |
| `/api/v2/schedules/:id` | GET | `requireOrgMembership()` |
| `/api/v2/schedules/:id` | PATCH/DELETE | `requireAdmin()` |
| `/api/v2/reports/device-health` | GET | `requireAdmin()` |
| `/api/v2/metadata` | GET | `requireOrgMembership()` |
| `/api/v2/alerts` | GET | `requireOrgMembership()` |
| `/api/v2/alerts/:id` | GET | `requireOrgMembership()` |
| `/api/v2/alerts/:id` | PATCH | `requireAdmin()` |
| `/api/v2/alert-rules` | GET | `requireOrgMembership()` |
| `/api/v2/alert-rules` | POST | `requireAdmin()` |
| `/api/v2/alert-rules/:id` | GET | `requireOrgMembership()` |
| `/api/v2/alert-rules/:id` | PATCH/DELETE | `requireAdmin()` |

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

## Testing

The project includes comprehensive test coverage across unit, integration, and E2E tests.

### Test Structure

```
__tests__/
  unit/                          # Unit tests
    models/                      # Model tests (DeviceV2, ReadingV2, ScheduleV2)
    validations/                 # Zod schema validation tests (device, reading, schedule, report)
    auth/                        # Auth and RBAC utility tests
    lib/                         # RBAC client hook tests, query hooks, v2-client
    utils/                       # Utility function tests
  integration/api/               # API integration tests
    devices.test.ts              # Device CRUD endpoints
    readings.test.ts             # Reading endpoints
    analytics.test.ts            # Analytics endpoints
    audit.test.ts                # Audit trail endpoints
    schedules.integration.test.ts # Schedule CRUD endpoints
    reports.integration.test.ts  # Report generation endpoints
e2e/                             # Playwright E2E tests
  dashboard.spec.ts              # Dashboard functionality
  device-detail.spec.ts          # Device detail page
  error-handling.spec.ts         # Error handling flows
  real-time-updates.spec.ts      # Real-time Pusher updates
```

### Running Tests

```bash
pnpm test                 # All Jest tests
pnpm test:unit            # Unit tests only
pnpm test:integration     # Integration tests only
pnpm test:coverage        # With coverage report
pnpm test:e2e             # Playwright E2E tests
pnpm test:e2e:ui          # Playwright UI mode
```

### E2E Testing with Auth Bypass

Set `E2E_TESTING=true` in `.env.local` to bypass Clerk authentication during E2E tests. The `proxy.ts` middleware checks this environment variable.

### Test Configuration

- **Jest**: `jest.config.js` - Unit and integration test runner
- **Playwright**: `playwright.config.ts` - E2E test configuration
- **Coverage**: `codecov.yml` - Coverage reporting configuration

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

### Schedule Validation

- **createScheduleSchema**: Bulk creation with 1-100 device_ids, service_type, future date, optional notes
- **updateScheduleSchema**: Partial updates (scheduled_date, status, notes)
- **listSchedulesQuerySchema**: Pagination, sorting (5 fields), filtering (status, service_type, device_id, date range)
- **getScheduleQuerySchema**: Optional `include_device` flag for device details
- **scheduleIdParamSchema**: MongoDB ObjectId validation

### Report Validation

- **reportGenerateQuerySchema**: Scope (`all` or `building`), building_id (required when scope is `building`)

### Common Validation Helpers

- **Pagination**: Cursor-based, offset-based, analytics (higher limits)
- **Date Ranges**: Past/future dates, range validation
- **Enumerations**: Device types (15), reading units (35), statuses, sources
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

### Adding a New Device / Reading Type

Currently supports **15 device types**: temperature, humidity, occupancy, power, co2, pressure, light, motion, air_quality, water_flow, gas, vibration, voltage, current, energy

Device types and reading types are **one list**: a device of type X emits readings of type X, and `metric: 'value'` alert rules select devices by reading type. The list is copied by hand into a dozen places. Some copies fail loudly if you miss them; several **fail silently**, so work through the whole checklist. Verify with `grep -rn "water_flow" --include='*.ts' --include='*.tsx'` before you finish.

**1. Type and schema definitions — miss one and `tsc` or Mongoose tells you.**

| File | What to change | If missed |
| ---- | -------------- | --------- |
| [models/v2/ReadingV2.ts](models/v2/ReadingV2.ts) | `ReadingType` union **and** the `metadata.type` enum array in `MetadataSchema` | Union: `tsc` error. Enum: every insert of that type is rejected at write time |
| [models/v2/DeviceV2.ts](models/v2/DeviceV2.ts) | `DeviceType` union **and** the `type` enum array in the schema | Same as above, for devices |
| [models/v2/AlertRuleV2.ts](models/v2/AlertRuleV2.ts) | `READING_TYPES` | **`tsc` error** — the two `AssertNever` aliases beside it exist for exactly this. See "if missed" below for why they were added |
| [lib/validations/v2/reading.validation.ts](lib/validations/v2/reading.validation.ts) | `readingTypeSchema` (Zod enum) | Ingest 400s the new type |
| [lib/validations/v2/device.validation.ts](lib/validations/v2/device.validation.ts) | `deviceTypeSchema` (Zod enum) | Device create/update 400s the new type |
| [types/v2/reading.types.ts](types/v2/reading.types.ts) | `ReadingType` (client-safe copy) | `tsc` error, via the conformance assertions |
| [types/v2/device.types.ts](types/v2/device.types.ts) | `DeviceType` (client-safe copy) | `tsc` error, via the conformance assertions |
| [lib/simulation/readings.ts](lib/simulation/readings.ts) | `TYPE_SENSITIVITY` **and** a `case` in `generateReading`'s switch | `tsc` error both times (`Record<ReadingType, …>`; definite assignment on `value`/`unit`) |

`ReadingTypeName` in [types/v2/alert.types.ts](types/v2/alert.types.ts) is now an **alias** of `ReadingType`, not a copy — nothing to change there.

**2. Units.** Add any new `ReadingUnit` values (35 today) to *all three* copies: `models/v2/ReadingV2.ts` (union + schema enum), `lib/validations/v2/reading.validation.ts` (`readingUnitSchema`), `types/v2/reading.types.ts`.

**3. Silent fallbacks — nothing fails, the behaviour is just wrong.**

| File | What to change | If missed |
| ---- | -------------- | --------- |
| [app/api/v2/readings/ingest/route.ts](app/api/v2/readings/ingest/route.ts) | `getDefaultUnit`'s unit map | Readings are stored with unit `'raw'` |
| [scripts/v2/seed-v2.ts](scripts/v2/seed-v2.ts) | `deviceTypes`, `unitsByType`, `generateReading`'s switch | Seeded data never contains the type, and any that does gets unit `'raw'` and a nonsense value range |

**4. UI lists — the type exists but is invisible.**

| File | What to change | If missed |
| ---- | -------------- | --------- |
| [app/devices/_components/DeviceFilterModal.tsx](app/devices/_components/DeviceFilterModal.tsx) | `DEVICE_TYPES` | `tsc` error, via the conformance assertions |
| [components/devices/CreateDeviceModal.tsx](components/devices/CreateDeviceModal.tsx) | `DEVICE_TYPES` options | **Silent** — the type cannot be chosen when creating a device |
| [components/alerts/CreateAlertRuleModal.tsx](components/alerts/CreateAlertRuleModal.tsx) | `READING_TYPE_OPTIONS` | **Silent** — no alert rule can be scoped to the type from the UI |
| [components/DeviceInventoryCard.tsx](components/DeviceInventoryCard.tsx) | `getDeviceIcon` / `getIconBgColor` switches | **Silent** — falls through to the generic icon |

**5. Docs.** Update the type lists in [docs/models-v2.md](docs/models-v2.md), [docs/api-v2.md](docs/api-v2.md), and the "15 Device/Reading Types" line near the top of this file.

**6. Re-run the guards.** `npx tsc --noEmit` covers the type-level copies; `pnpm test __tests__/unit/models/AlertRuleV2.test.ts` compares `READING_TYPES` against the Mongoose and Zod enums as sets (`tsc` cannot see inside a `new Schema({ enum: [...] })`).

**Why `READING_TYPES` gets a compile-time guard and the others get a table.** `as const satisfies readonly ReadingType[]` only checks that each element *is* a `ReadingType`; it does not check that every `ReadingType` is present. An omission there used to compile clean, and then: `buildRuleBuckets` ([lib/alerting/rule-cache.ts](lib/alerting/rule-cache.ts)) seeds no bucket for the type, `evaluateReadings` looks it up with `byType.get(type) ?? []` and evaluates against zero rules, and a **fleet-wide rule** — one with no `selector.types` at all, such as the seeded "Low battery" rule — is expanded across that same list, so it stops applying to the new type too. No error, no metric, no log, and every affected rule still reads as Enabled in the UI. The `AssertNever` aliases in `models/v2/AlertRuleV2.ts` turn that into a `tsc` error naming the missing type.

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
const readings = await ReadingV2.getForDeviceInRange('device_001', startDate, endDate, {
  type: 'temperature',
  limit: 100,
  includeInvalid: false,
});

// Get anomalous readings
const anomalies = await ReadingV2.getAnomalies('device_001', {
  startTime: new Date('2024-01-01'),
  minScore: 0.7,
  limit: 50,
});

// Bulk insert readings
await ReadingV2.bulkInsertReadings([
  {
    metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' },
    value: 22.5,
  },
  // ... more readings
]);
```

**ScheduleV2 Methods:**

```typescript
// Find schedules by device
const schedules = await ScheduleV2.findByDevice('device_001', 'scheduled');

// Find upcoming scheduled maintenance (next 30 days)
const upcoming = await ScheduleV2.findUpcoming(30, { service_type: 'calibration' });

// Atomically complete a schedule (validates status transition)
await ScheduleV2.complete(scheduleId, 'admin@example.com');

// Atomically cancel a schedule (validates status transition)
await ScheduleV2.cancel(scheduleId, 'admin@example.com');
```

**Status Transitions**: `scheduled` -> `completed` | `cancelled`. Completed/cancelled schedules cannot transition further. Invalid transitions throw `ScheduleTransitionError`.

**Service Types**: `firmware_update`, `calibration`, `emergency_fix`, `general_maintenance`

**AlertRuleV2 / AlertV2 Methods:**

```typescript
// Find active (non-deleted) alert rules
const activeRules = await AlertRuleV2.findActive({ enabled: true });

// Soft delete an alert rule
await AlertRuleV2.softDelete(ruleId, 'admin@example.com');

// Atomically acknowledge a firing alert (validates status transition)
await AlertV2.acknowledge(alertId, 'admin@example.com');

// Atomically resolve a firing/acknowledged alert (validates status transition)
await AlertV2.resolve(alertId, 'admin@example.com', 'manual');
```

**Alert Status Transitions**:

```
pending  -> firing            (breach held for for_duration_seconds)
pending  -> DELETED           (condition cleared, or the rule's condition changed)
firing   -> acknowledged      (an operator picked it up)
firing   -> resolved          (legal, and the common path)
acknowledged -> resolved
resolved -> (terminal)
```

`acknowledged` is **not** a required step: `AlertV2.resolve()` matches `status: { $in: ['firing', 'acknowledged'] }`, and the evaluator's own auto-resolve goes straight from `firing`. Acknowledging is an operator convenience, not a gate.

`pending` is internal — it is never returned by the API, raises no notification, and is **deleted rather than resolved** when it stops breaching (`deleteOne`/`deleteMany` guarded on `status: 'pending'`, in `evaluate.ts`, `sweep.ts` and `PATCH /alert-rules/[id]`). An episode that never fired is not history, and deleting it is what keeps the invariant "every visible alert has `fired_at`" true. So `pending` never reaches `resolved`.

`is_open` is a denormalization of `status` (`is_open === (status !== 'resolved')`), enforced at every write path in [models/v2/AlertV2.ts](models/v2/AlertV2.ts) — a document where the two disagree stays in the partial unique dedup index forever and that (rule, device) pair can never fire again. Invalid lifecycle transitions throw `AlertTransitionError`; a status/`is_open` mismatch throws `AlertInvariantError`.

**Where evaluation runs** — the two write paths are **not** symmetric:

| | `POST /api/v2/readings/ingest` | `GET /api/v2/cron/simulate` |
| --- | --- | --- |
| `safeEvaluateReadings()` | yes, after the insert commits | yes, after the insert commits |
| `safeSweepStaleAlerts()` | **no** | yes |

The staleness sweep is one query per cron invocation, not per ingest, and it needs the set of devices that just reported — which only the cron path has. Consequence worth knowing: on an ingest-only deployment, an alert for a device that stops reporting is never closed as stale.

Both wrappers never throw, so an alerting failure never affects the read/write contract of either route. Always call the `safe*` wrappers from `@/lib/alerting`, never `evaluateReadings()`/`sweepStaleAlerts()` directly from a route.

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
11. **RBAC enforcement**: Always use `requireAdmin()` for mutations and `requireOrgMembership()` for reads—never skip role checks
12. **Client-side RBAC**: Use `useRbac()` hook for UI hints only—always enforce permissions server-side in API routes
13. **Schedule status transitions**: Only `scheduled` -> `completed`/`cancelled` is valid—completed and cancelled are terminal states. Use `ScheduleV2.complete()` and `ScheduleV2.cancel()` for atomic transitions
14. **Bulk schedule limits**: Schedule creation limited to 100 devices per request—batch larger operations

## Key Files to Reference

### Core Models & Data

- V2 models: [models/v2/DeviceV2.ts](models/v2/DeviceV2.ts), [models/v2/ReadingV2.ts](models/v2/ReadingV2.ts), [models/v2/ScheduleV2.ts](models/v2/ScheduleV2.ts), [models/v2/AlertRuleV2.ts](models/v2/AlertRuleV2.ts), [models/v2/AlertV2.ts](models/v2/AlertV2.ts)
- Database connection: [lib/db.ts](lib/db.ts)

### Validation & Error Handling

- Validation schemas: [lib/validations/v2/](lib/validations/v2/)
- Error handling: [lib/errors/errorHandler.ts](lib/errors/errorHandler.ts), [lib/errors/errorCodes.ts](lib/errors/errorCodes.ts)
- Sanitization: [lib/validations/sanitizer.ts](lib/validations/sanitizer.ts)

### API Layer

- API client: [lib/api/v2-client.ts](lib/api/v2-client.ts)
- React Query hooks: [lib/query/hooks/](lib/query/hooks/)
- Response helpers: [lib/api/response.ts](lib/api/response.ts), [lib/api/pagination.ts](lib/api/pagination.ts)
- API routes: [app/api/v2/](app/api/v2/)
- Alerting: [lib/alerting/](lib/alerting/) — rule evaluation (`evaluate.ts`), staleness sweep (`sweep.ts`), Pusher notify (`notify.ts`), rule cache (`rule-cache.ts`), selector matching (`selector.ts`), demo-mode redaction (`redact.ts`)

### Security & Performance

- Rate limiting: [lib/ratelimit/](lib/ratelimit/)
- Caching: [lib/cache/](lib/cache/)
- Authentication middleware: [proxy.ts](proxy.ts) (Clerk + org validation)
- RBAC utilities: [lib/auth/](lib/auth/) (`requireAdmin()`, `requireOrgMembership()`, `useRbac()`)
- Monitoring: [lib/monitoring/](lib/monitoring/)
- Redis: [lib/redis/](lib/redis/)
- Middleware: [lib/middleware/](lib/middleware/)

### Scripts & Utilities

- Seeding: [scripts/v2/seed-v2.ts](scripts/v2/seed-v2.ts)
- Simulation: [scripts/v2/simulate.ts](scripts/v2/simulate.ts)
- Testing: [scripts/v2/test-api.ts](scripts/v2/test-api.ts)
- Indexing: [scripts/v2/create-indexes-v2.ts](scripts/v2/create-indexes-v2.ts), [scripts/v2/verify-indexes.ts](scripts/v2/verify-indexes.ts)

### Testing

- Unit tests: [**tests**/unit/](__tests__/unit/)
- Integration tests: [**tests**/integration/api/](__tests__/integration/api/)
- E2E tests: [e2e/](e2e/)
- Jest config: [jest.config.js](jest.config.js)
- Playwright config: [playwright.config.ts](playwright.config.ts)

### Frontend Components (Key)

- Device creation: [components/devices/CreateDeviceModal.tsx](components/devices/CreateDeviceModal.tsx)
- Schedule management: [components/ScheduleList.tsx](components/ScheduleList.tsx), [components/ScheduleServiceModal.tsx](components/ScheduleServiceModal.tsx)
- Report generation: [components/GenerateReportModal.tsx](components/GenerateReportModal.tsx)
- Alert management: [components/alerts/AlertList.tsx](components/alerts/AlertList.tsx), [components/alerts/AlertDetailView.tsx](components/alerts/AlertDetailView.tsx), [components/alerts/CreateAlertRuleModal.tsx](components/alerts/CreateAlertRuleModal.tsx), [components/alerts/AlertToaster.tsx](components/alerts/AlertToaster.tsx)

### Documentation

- Quick start: [QUICK_START_V2.md](plans/QUICK_START_V2.md)
- Phase 5 plan: [PLAN_PHASE_5.md](plans/PLAN_PHASE_5.md)
- Test coverage setup: [docs/TEST_COVERAGE_SETUP.md](docs/TEST_COVERAGE_SETUP.md)
