# Phase 4 Alerting Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Infrasight threshold-based alerting — declarative rules, a four-state alert lifecycle, evaluation inline on both write paths, eight API endpoints, real-time Pusher delivery, and an operator UI.

**Architecture:** Two new MongoDB collections (`alert_rules_v2`, `alerts_v2`). A pure-ish evaluator in `lib/alerting/` is called by both write paths (`POST /api/v2/readings/ingest` and `GET /api/v2/cron/simulate`) *after* their insert commits, so it can never affect data durability. Deduplication is enforced by a partial unique index on `{ rule_id, device_id }` filtered to `is_open: true`, not by application logic. Alerts reach the browser as a single tagged Pusher event that degrades to an aggregate "storm" summary above a bounded size.

**Tech Stack:** Next.js 16 (App Router, Turbopack), TypeScript, Mongoose 9, Zod 4, MongoDB, Redis (Upstash/ioredis), Pusher 5, Clerk, React Query 5, react-toastify 11, Jest (ts-jest, mongodb-memory-server), Playwright.

**Source spec:** [`docs/superpowers/specs/2026-08-01-alerting-subsystem-design.md`](../specs/2026-08-01-alerting-subsystem-design.md). Read it before starting — this plan implements it and does not repeat its reasoning.

**GitHub issues:** #96 (models/validation) → Tasks 1–3. #97 (evaluation) → Tasks 4–9. #98 (lifecycle/API) → Tasks 10–11. #99 (UI) → Tasks 12, 15–18. #100 (Pusher) → Tasks 13–14. Tasks 19–20 (seed, E2E) are cross-cutting. Full mapping and a dependency graph are at the end of this document.

## Global Constraints

Every task's requirements implicitly include this section.

- **Mongoose hot-reload guard.** Every model export MUST use `mongoose.models.X || mongoose.model(...)`. Without it, hot reload crashes.
- **Never name a schema field `model`.** It collides with `Document.model`.
- **Never touch `readings_v2`.** It is a MongoDB timeseries collection; `timeField`, `metaField`, and `granularity` cannot be altered after creation. Phase 4 is additive only.
- **Soft-delete predicate is `{ 'audit.deleted_at': { $exists: false } }`**, not `null`. This matches `DeviceV2.findActive` (`models/v2/DeviceV2.ts:381`).
- **Index predicates must be MongoDB 3.2-compatible.** No `$in` inside a `partialFilterExpression` (that needs 6.0+). Equality and range predicates only.
- **API responses** use `jsonSuccess()` / `jsonPaginated()` from `lib/api/response.ts`. Never raw `NextResponse.json` in v2 routes.
- **API handlers** wrap their body in `withErrorHandler(async () => { ... })()` from `@/lib/errors` and throw `ApiError` with a code from `ErrorCodes`.
- **RBAC:** reads use `await requireOrgMembership()`; writes use `const { userId, user } = await requireAdmin()` then `getAuditUser(userId, user)`. Both from `@/lib/auth`.
- **Mutating routes** are exported as `withRateLimit(withRequestValidation(handler, ValidationPresets.jsonApi))`, matching `app/api/v2/schedules/route.ts:240`.
- **Pusher payloads reach every connected client.** Never put an email address in one. `actor` carries the Clerk **user id** or the literal `'system'`.
- **Pusher caps a single event at 10 KB.** The bounded-payload logic in Task 13 is not optional.
- **Pusher failures are swallowed and logged**, matching `app/api/v2/cron/simulate/route.ts:62-70`. They never fail a committed write.
- **`STALE_AFTER_SECONDS` default is `1800`.** `ALERT_EVENT_MAX` is `20`. `ALERT_EVENT_MAX_BYTES` is `8192`.
- **Rule cache TTL is 60 seconds**, key is global (no `orgPrefix`) — the cron path authenticates with `SEED_SECRET` and has no Clerk context to derive an `orgId` from.
- **Alerts are never cached.** Deliberate departure from the other v2 read endpoints.
- **Alerting is not a backfill engine.** A batch is reduced to one aggregate decision per (rule, device) pair; a breach→clear→breach batch yields one episode.
- **Tests:** `pnpm test <path>` runs Jest. Node tests match `**/__tests__/**/*.test.ts`; component tests match `**/__tests__/**/*.test.tsx` (jsdom project). Clerk is globally mocked as `org:admin` in `__tests__/setup/jest.setup.ts`; override per-test with helpers from `__tests__/setup/auth-helpers.ts`.
- **All four gates are STRICT — zero tolerance, no baselines.** `main`'s `chore: fix typecheck and lint failures across the repo` (b43468d) is merged into this branch, so the baseline-diffing `tscheck`/`lintcheck` scripts this plan used through Task 11 are **retired**. Do not run them; do not consult their baseline files. The gates are the raw commands:

  | Gate | Command | Required result |
  | --- | --- | --- |
  | Types | `npx tsc --noEmit` | **0 errors** |
  | Lint | `pnpm lint` | **0 problems** |
  | Build | `pnpm build` | clean |
  | Tests | `pnpm test` | **2433 passing / 98 suites** (node 2272 + jsdom) |

  Any error from any of them is genuinely yours. Note `jest.config.js` defines two projects — `node` (`**/__tests__/**/*.test.ts`) and `jsdom` (`**/__tests__/**/*.test.tsx`) — so a bare `pnpm test` runs both, and a test file's **extension decides its environment**. A React test named `.test.ts` lands in the node project and fails with no DOM.
- **`pnpm test` counts grow as you go.** The numbers above are the baseline entering Task 12; each task adds to them. A *falling* count means you broke something.
- **Commit style:** conventional commits (`feat:`, `test:`, `fix:`, `refactor:`, `docs:`). Commit at the end of every task, never mid-task.

## File Structure

**New model + validation + types**

| File | Responsibility |
| --- | --- |
| `models/v2/AlertRuleV2.ts` | `alert_rules_v2` schema, `AlertMetric`/`AlertComparison`/`AlertSeverity` unions, `findActive`/`softDelete` statics, 2 indexes |
| `models/v2/AlertV2.ts` | `alerts_v2` schema, `AlertStatus`/`AlertResolution` unions, `AlertTransitionError`, `acknowledge`/`resolve` statics, 6 indexes |
| `lib/validations/v2/alert-rule.validation.ts` | Zod schemas for rule CRUD + the two cross-field refinements |
| `lib/validations/v2/alert.validation.ts` | Zod schemas for alert list/get/patch |
| `types/v2/alert.types.ts` | **Client-safe** wire types only — no mongoose imports (the Pusher context imports `AlertEvent` from here) |

**New evaluation engine** — `lib/alerting/`

| File | Responsibility |
| --- | --- |
| `lib/alerting/types.ts` | Server-internal types (`EvaluableDevice`, `EvaluableReading`, `EvaluationResult`) |
| `lib/alerting/selector.ts` | Pure predicates: `matchesSelector`, `compare`, `METRIC_ACCESSORS`. No I/O |
| `lib/alerting/rule-cache.ts` | Cached rule load, `_id` normalization, `Map<ReadingType, rules[]>` bucketing |
| `lib/alerting/evaluate.ts` | `evaluateReadings()` — reduction, decision, bulk write, `11000` filtering |
| `lib/alerting/sweep.ts` | `sweepStaleAlerts()` — staleness and device-inactive resolution |
| `lib/alerting/notify.ts` | `publishAlertEvents()` — bounded envelope construction + Pusher trigger |
| `lib/alerting/index.ts` | Public surface: `safeEvaluateReadings`, `safeSweepStaleAlerts`, re-exports |

**Modified shared infrastructure**

| File | Change |
| --- | --- |
| `lib/errors/errorCodes.ts` | 5 new codes + registry entries |
| `lib/cache/keys.ts` | `ALERT_RULES` prefix + `alertRulesKey()` (no arguments) |
| `lib/cache/invalidation.ts` | `invalidateAlertRules()` |
| `lib/cache/index.ts` | Re-export the two above |
| `lib/monitoring/metrics.ts` | `recordAlert()` + 4 alert metrics in the Prometheus export |
| `lib/monitoring/index.ts` | Re-export `recordAlert` |
| `lib/pusher-context.tsx` | Bind `alert-event`; add `subscribeAlerts`/`unsubscribeAlerts` + `usePusherAlerts` |
| `app/api/v2/readings/ingest/route.ts` | Widen device projection; call `safeEvaluateReadings` after insert |
| `app/api/v2/cron/simulate/route.ts` | Widen device projection; call `safeEvaluateReadings` + `safeSweepStaleAlerts` |
| `lib/api/v2-client.ts` | `alertsApi`, `alertRulesApi` namespaces |
| `lib/query/queryClient.ts` | `queryKeys.alerts`, `queryKeys.alertRules` |
| `types/v2/index.ts` | Re-export alert types |
| `scripts/v2/create-indexes-v2.ts`, `scripts/v2/verify-indexes.ts` | New index definitions |
| `scripts/v2/alert-rule-seeds.ts` (new) | Four starter rules — side-effect-free so tests can import it |
| `scripts/v2/seed-v2.ts` | Insert the seeded rules |
| `components/TopNav.tsx` | Alerts nav item + open-count badge |
| `app/analytics/page.tsx` | `AlertsPanel` → `AnomalyPanel` |

**New API routes**

`app/api/v2/alerts/route.ts`, `app/api/v2/alerts/[id]/route.ts`, `app/api/v2/alert-rules/route.ts`, `app/api/v2/alert-rules/[id]/route.ts`

**New UI**

`app/alerts/page.tsx`, `app/alerts/[id]/page.tsx`, `app/alerts/rules/page.tsx`, `components/alerts/{AlertSeverityBadge,AlertStatusBadge,AlertList,AlertDetailView,AlertRuleList,CreateAlertRuleModal}.tsx`, `components/alerts/useAlertFilterParams.ts`, `components/dashboard/ActiveAlertsWidget.tsx`, `lib/query/hooks/{useAlerts,useAlertRules}.ts`. `components/AlertsPanel.tsx` is **renamed** to `components/AnomalyPanel.tsx` (it is live at `app/analytics/page.tsx:5,84` — deleting it breaks the build).

---

### Task 1: AlertRuleV2 model

**Files:**
- Create: `models/v2/AlertRuleV2.ts`
- Modify: `__tests__/setup/factories.ts` (append an alert-rule factory)
- Modify: `scripts/v2/create-indexes-v2.ts` (add `ALERT_RULE_V2_INDEXES`)
- Test: `__tests__/unit/models/AlertRuleV2.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type AlertMetric = 'value' | 'anomaly_score' | 'battery_level'`
  - `export type AlertComparison = 'gt' | 'gte' | 'lt' | 'lte'`
  - `export type AlertSeverity = 'info' | 'warning' | 'critical'`
  - `export const READING_TYPES: readonly ReadingType[]` (all 15, exported for reuse by the validation schema and the rule bucketer)
  - `export interface IAlertRuleSelector { types?: ReadingType[]; building_id?: string; floor?: number; zone?: string; tags?: string[] }`
  - `export interface IAlertRuleV2 { _id: Types.ObjectId; name: string; description?: string; enabled: boolean; selector: IAlertRuleSelector; metric: AlertMetric; comparison: AlertComparison; threshold: number; for_duration_seconds: number; severity: AlertSeverity; cooldown_seconds: number; audit: IAlertRuleAudit }`
  - `AlertRuleV2.findActive(filter?): Query`, `AlertRuleV2.softDelete(id: string, deletedBy: string): Promise<Doc | null>`
  - `createAlertRuleInput(overrides?): AlertRuleInput` from `__tests__/setup/factories`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/models/AlertRuleV2.test.ts`:

```typescript
/**
 * AlertRuleV2 Model Unit Tests
 */

import AlertRuleV2, { READING_TYPES } from '@/models/v2/AlertRuleV2';
import { createAlertRuleInput, resetCounters } from '../../setup/factories';

describe('AlertRuleV2 Model', () => {
  beforeEach(() => {
    resetCounters();
  });

  describe('document creation', () => {
    it('should create a rule with defaults applied', async () => {
      const rule = await AlertRuleV2.create(
        createAlertRuleInput({
          name: 'High temperature',
          metric: 'value',
          comparison: 'gt',
          threshold: 30,
          severity: 'critical',
          selector: { types: ['temperature'] },
        })
      );

      expect(rule.enabled).toBe(true);
      expect(rule.for_duration_seconds).toBe(0);
      expect(rule.cooldown_seconds).toBe(300);
      expect(rule.selector.types).toEqual(['temperature']);
      expect(rule.audit.created_at).toBeInstanceOf(Date);
      expect(rule.audit.deleted_at).toBeUndefined();
    });

    it('should allow a rule with no selector types (fleet-wide)', async () => {
      const rule = await AlertRuleV2.create(
        createAlertRuleInput({ metric: 'battery_level', comparison: 'lt', threshold: 20, selector: {} })
      );

      expect(rule.selector.types).toBeUndefined();
    });

    it('should reject an unknown metric', async () => {
      await expect(
        AlertRuleV2.create(createAlertRuleInput({ metric: 'humidity_delta' as never }))
      ).rejects.toThrow();
    });

    it('should expose all 15 reading types', () => {
      expect(READING_TYPES).toHaveLength(15);
      expect(READING_TYPES).toContain('temperature');
      expect(READING_TYPES).toContain('energy');
    });
  });

  describe('findActive', () => {
    it('should exclude soft-deleted rules', async () => {
      const kept = await AlertRuleV2.create(createAlertRuleInput({ name: 'Kept' }));
      const gone = await AlertRuleV2.create(createAlertRuleInput({ name: 'Gone' }));
      await AlertRuleV2.softDelete(String(gone._id), 'admin@example.com');

      const active = await AlertRuleV2.findActive().lean();

      expect(active).toHaveLength(1);
      expect(String(active[0]._id)).toBe(String(kept._id));
    });

    it('should accept an additional filter', async () => {
      await AlertRuleV2.create(createAlertRuleInput({ name: 'On', enabled: true }));
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Off', enabled: false }));

      const active = await AlertRuleV2.findActive({ enabled: true }).lean();

      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('On');
    });
  });

  describe('softDelete', () => {
    it('should stamp deleted_at and deleted_by', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const deleted = await AlertRuleV2.softDelete(String(rule._id), 'admin@example.com');

      expect(deleted?.audit.deleted_at).toBeInstanceOf(Date);
      expect(deleted?.audit.deleted_by).toBe('admin@example.com');
    });

    it('should return null for an unknown id', async () => {
      const missing = await AlertRuleV2.softDelete('507f1f77bcf86cd799439011', 'admin@example.com');
      expect(missing).toBeNull();
    });
  });

  describe('middleware', () => {
    it('should bump audit.updated_at on findOneAndUpdate', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());
      const before = rule.audit.updated_at;

      await new Promise(r => setTimeout(r, 5));
      const updated = await AlertRuleV2.findByIdAndUpdate(
        rule._id,
        { $set: { threshold: 99 } },
        { new: true }
      );

      expect(updated!.audit.updated_at.getTime()).toBeGreaterThan(before.getTime());
    });
  });
});
```

Append to `__tests__/setup/factories.ts`:

```typescript
// ============================================================================
// ALERT RULE FACTORIES
// ============================================================================

export interface AlertRuleInput {
  name: string;
  description?: string;
  enabled?: boolean;
  selector: Record<string, unknown>;
  metric: 'value' | 'anomaly_score' | 'battery_level';
  comparison: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  for_duration_seconds?: number;
  severity: 'info' | 'warning' | 'critical';
  cooldown_seconds?: number;
  audit?: Record<string, unknown>;
}

let alertRuleCounter = 0;

export function createAlertRuleInput(overrides: Partial<AlertRuleInput> = {}): AlertRuleInput {
  alertRuleCounter += 1;
  return {
    name: `Test Rule ${alertRuleCounter}`,
    enabled: true,
    selector: { types: ['temperature'] },
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    severity: 'warning',
    audit: {
      created_at: new Date(),
      created_by: 'test@example.com',
      updated_at: new Date(),
      updated_by: 'test@example.com',
    },
    ...overrides,
  };
}
```

Also add `alertRuleCounter = 0;` to the body of the existing `resetCounters()` function in that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/models/AlertRuleV2.test.ts`
Expected: FAIL — `Cannot find module '@/models/v2/AlertRuleV2'`

- [ ] **Step 3: Write the model**

Create `models/v2/AlertRuleV2.ts`:

```typescript
// `Types` is used only in type position here (Types.ObjectId as a field type),
// so it must be a type-only import or @typescript-eslint/consistent-type-imports
// fails. Task 7 does use `new Types.ObjectId()` and needs the value import.
import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type { ReadingType } from './ReadingV2';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * All 15 reading types. Exported so the validation schema and the rule
 * bucketer share one source of truth with the schema enum below.
 */
export const READING_TYPES = [
  'temperature',
  'humidity',
  'occupancy',
  'power',
  'co2',
  'pressure',
  'light',
  'motion',
  'air_quality',
  'water_flow',
  'gas',
  'vibration',
  'voltage',
  'current',
  'energy',
] as const satisfies readonly ReadingType[];

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

export type AlertMetric = 'value' | 'anomaly_score' | 'battery_level';
export type AlertComparison = 'gt' | 'gte' | 'lt' | 'lte';
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Declarative device selector. Every field is optional; an absent field means
 * "no constraint on this dimension". Devices must satisfy ALL present fields,
 * and for `tags` must carry ALL listed tags.
 */
export interface IAlertRuleSelector {
  types?: ReadingType[];
  building_id?: string;
  floor?: number;
  zone?: string;
  tags?: string[];
}

export interface IAlertRuleAudit {
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  deleted_at?: Date;
  deleted_by?: string;
}

export interface IAlertRuleV2 {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  enabled: boolean;
  selector: IAlertRuleSelector;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;
  /** Breach must hold this long before the alert fires. 0 = fire immediately. */
  for_duration_seconds: number;
  severity: AlertSeverity;
  /** A new episode for the same (rule, device) pair is suppressed this long after resolution. */
  cooldown_seconds: number;
  audit: IAlertRuleAudit;
}

// ============================================================================
// MONGOOSE SCHEMA
// ============================================================================

const SelectorSchema = new Schema<IAlertRuleSelector>(
  {
    // `default: undefined` overrides Mongoose's implicit `[]` default for array
    // paths, so an omitted field stays truly absent (no constraint) rather than
    // becoming a vacuous empty array. Without it a fleet-wide rule round-trips
    // as `types: []` instead of `types: undefined`.
    types: { type: [String], enum: READING_TYPES as unknown as string[], default: undefined },
    building_id: { type: String },
    floor: { type: Number },
    zone: { type: String },
    tags: { type: [String], default: undefined },
  },
  { _id: false }
);

const AuditSchema = new Schema<IAlertRuleAudit>(
  {
    created_at: { type: Date, default: () => new Date() },
    created_by: { type: String, required: true },
    updated_at: { type: Date, default: () => new Date() },
    updated_by: { type: String, required: true },
    deleted_at: { type: Date },
    deleted_by: { type: String },
  },
  { _id: false }
);

const AlertRuleV2Schema = new Schema<IAlertRuleV2>(
  {
    name: { type: String, required: true, maxlength: 200 },
    description: { type: String, maxlength: 1000 },
    enabled: { type: Boolean, default: true },
    selector: { type: SelectorSchema, default: () => ({}) },
    metric: {
      type: String,
      enum: ['value', 'anomaly_score', 'battery_level'],
      required: true,
    },
    comparison: {
      type: String,
      enum: ['gt', 'gte', 'lt', 'lte'],
      required: true,
    },
    threshold: { type: Number, required: true },
    for_duration_seconds: { type: Number, default: 0, min: 0, max: 86400 },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      required: true,
    },
    cooldown_seconds: { type: Number, default: 300, min: 0, max: 86400 },
    audit: { type: AuditSchema, required: true },
  },
  {
    collection: 'alert_rules_v2',
    timestamps: false,
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// The actual load predicate used by the evaluator's rule cache.
AlertRuleV2Schema.index({ enabled: 1, 'audit.deleted_at': 1 });

// Default list sort.
AlertRuleV2Schema.index({ 'audit.created_at': -1 });

// ============================================================================
// MIDDLEWARE
// ============================================================================

AlertRuleV2Schema.pre('save', function () {
  if (!this.isNew) this.audit.updated_at = new Date();
});

AlertRuleV2Schema.pre('findOneAndUpdate', function () {
  this.set({ 'audit.updated_at': new Date() });
});

// ============================================================================
// STATIC METHODS
// ============================================================================

AlertRuleV2Schema.statics.findActive = function (filter: Record<string, unknown> = {}) {
  return this.find({ ...filter, 'audit.deleted_at': { $exists: false } });
};

AlertRuleV2Schema.statics.softDelete = async function (id: string, deletedBy: string) {
  return this.findOneAndUpdate(
    { _id: id, 'audit.deleted_at': { $exists: false } },
    {
      $set: {
        'audit.deleted_at': new Date(),
        'audit.deleted_by': deletedBy,
        enabled: false,
      },
    },
    { new: true }
  );
};

// ============================================================================
// INTERFACE FOR STATIC METHODS
// ============================================================================

export interface IAlertRuleV2Model extends Model<IAlertRuleV2> {
  findActive(filter?: Record<string, unknown>): ReturnType<Model<IAlertRuleV2>['find']>;
  softDelete(id: string, deletedBy: string): Promise<(IAlertRuleV2 & Document) | null>;
}

// ============================================================================
// MODEL EXPORT
// ============================================================================

const AlertRuleV2 =
  (mongoose.models.AlertRuleV2 as unknown as IAlertRuleV2Model) ||
  mongoose.model<IAlertRuleV2, IAlertRuleV2Model>('AlertRuleV2', AlertRuleV2Schema);

export default AlertRuleV2;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/models/AlertRuleV2.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the index definitions to the index scripts**

In `scripts/v2/create-indexes-v2.ts`, add this block next to the existing `DEVICE_V2_INDEXES` and `READING_V2_INDEXES` arrays (there is no schedule index array in this file — follow those two):

```typescript
/**
 * AlertRuleV2 Index Definitions
 *
 * These indexes optimize:
 * - The evaluator's rule-cache load predicate (enabled + not soft-deleted)
 * - The default list sort
 */
const ALERT_RULE_V2_INDEXES: IndexDefinition[] = [
  {
    name: 'enabled_deleted_at',
    spec: { enabled: 1, 'audit.deleted_at': 1 } as IndexSpec,
    options: { background: true },
    description: 'Rule cache load predicate: { enabled: true, audit.deleted_at: { $exists: false } }',
  },
  {
    name: 'audit_created_at_desc',
    spec: { 'audit.created_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Default sort for GET /api/v2/alert-rules',
  },
];
```

Then register it inside `createIndexes()` alongside the existing collections, following the exact call shape already used there for `devices_v2` (collection name `alert_rules_v2`). Mirror the same addition in `scripts/v2/verify-indexes.ts` so `pnpm verify-indexes` checks for them.

- [ ] **Step 6: Verify the scripts still typecheck**

Run: `pnpm lint && npx tsc --noEmit`
Expected: lint clean; no type errors.

- [ ] **Step 7: Commit**

```bash
git add models/v2/AlertRuleV2.ts __tests__/unit/models/AlertRuleV2.test.ts __tests__/setup/factories.ts scripts/v2/create-indexes-v2.ts scripts/v2/verify-indexes.ts
git commit -m "feat(alerting): add AlertRuleV2 model with declarative selector"
```

---

### Task 2: AlertV2 model, transitions, and error codes

**Files:**
- Create: `models/v2/AlertV2.ts`
- Modify: `lib/errors/errorCodes.ts` (5 codes + 5 registry entries)
- Modify: `__tests__/setup/factories.ts` (append an alert factory)
- Modify: `scripts/v2/create-indexes-v2.ts`, `scripts/v2/verify-indexes.ts`
- Test: `__tests__/unit/models/AlertV2.test.ts`

**Interfaces:**
- Consumes: `AlertMetric`, `AlertComparison`, `AlertSeverity` from `@/models/v2/AlertRuleV2` (Task 1).
- Produces:
  - `export type AlertStatus = 'pending' | 'firing' | 'acknowledged' | 'resolved'`
  - `export type AlertResolution = 'manual' | 'auto' | 'stale' | 'device_inactive'`
  - `export type AlertTransitionCode = 'ALREADY_ACKNOWLEDGED' | 'ALREADY_RESOLVED' | 'NOT_YET_FIRING'`
  - `export class AlertTransitionError extends Error { code: AlertTransitionCode }`
  - `export interface IAlertV2 { ... }` (full shape below)
  - `AlertV2.acknowledge(id: string, by: string): Promise<Doc | null>`
  - `AlertV2.resolve(id: string, by: string, resolution?: AlertResolution): Promise<Doc | null>`
  - New `ErrorCodes.ALERT_NOT_FOUND`, `.ALERT_RULE_NOT_FOUND`, `.ALERT_ALREADY_ACKNOWLEDGED`, `.ALERT_ALREADY_RESOLVED`, `.INVALID_ALERT_STATUS_TRANSITION`
  - `createAlertInput(overrides?): AlertInput` from `__tests__/setup/factories`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/models/AlertV2.test.ts`:

```typescript
/**
 * AlertV2 Model Unit Tests
 *
 * Covers every legal transition, every illegal transition throwing the correct
 * typed code, and the is_open === (status !== 'resolved') invariant after each.
 */

import { Types } from 'mongoose';
import AlertV2, { AlertTransitionError } from '@/models/v2/AlertV2';
import { createAlertInput, resetCounters } from '../../setup/factories';

/** The one invariant that keeps the partial unique index correct. */
function assertIsOpenInvariant(doc: { status: string; is_open: boolean }) {
  expect(doc.is_open).toBe(doc.status !== 'resolved');
}

describe('AlertV2 Model', () => {
  beforeEach(() => {
    resetCounters();
  });

  describe('AlertTransitionError', () => {
    it('should carry name and code', () => {
      const error = new AlertTransitionError('ALREADY_RESOLVED', 'Already resolved');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AlertTransitionError');
      expect(error.code).toBe('ALREADY_RESOLVED');
    });
  });

  describe('document creation', () => {
    it('should create a firing alert satisfying the is_open invariant', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

      assertIsOpenInvariant(alert);
      expect(alert.audit.created_by).toBe('system');
    });

    it('should reject an unknown status', async () => {
      await expect(
        AlertV2.create(createAlertInput({ status: 'exploded' as never }))
      ).rejects.toThrow();
    });
  });

  describe('deduplication index', () => {
    it('should reject a second open episode for the same rule and device', async () => {
      await AlertV2.init(); // ensure indexes are built before asserting on them

      const rule_id = new Types.ObjectId();
      await AlertV2.create(createAlertInput({ rule_id, device_id: 'device_001', is_open: true }));

      await expect(
        AlertV2.create(createAlertInput({ rule_id, device_id: 'device_001', is_open: true }))
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('should allow unlimited resolved episodes for the same rule and device', async () => {
      await AlertV2.init();

      const rule_id = new Types.ObjectId();
      await AlertV2.create(
        createAlertInput({ rule_id, device_id: 'device_002', status: 'resolved', is_open: false })
      );
      await AlertV2.create(
        createAlertInput({ rule_id, device_id: 'device_002', status: 'resolved', is_open: false })
      );

      const count = await AlertV2.countDocuments({ rule_id, device_id: 'device_002' });
      expect(count).toBe(2);
    });
  });

  describe('acknowledge', () => {
    it('should move firing to acknowledged and leave is_open true', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

      const acked = await AlertV2.acknowledge(String(alert._id), 'user_admin');

      expect(acked!.status).toBe('acknowledged');
      expect(acked!.audit.acknowledged_by).toBe('user_admin');
      expect(acked!.audit.acknowledged_at).toBeInstanceOf(Date);
      assertIsOpenInvariant(acked!);
    });

    it('should throw ALREADY_ACKNOWLEDGED when already acknowledged', async () => {
      const alert = await AlertV2.create(
        createAlertInput({ status: 'acknowledged', is_open: true })
      );

      await expect(AlertV2.acknowledge(String(alert._id), 'user_admin')).rejects.toMatchObject({
        name: 'AlertTransitionError',
        code: 'ALREADY_ACKNOWLEDGED',
      });
    });

    it('should throw ALREADY_RESOLVED when resolved', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      await expect(AlertV2.acknowledge(String(alert._id), 'user_admin')).rejects.toMatchObject({
        code: 'ALREADY_RESOLVED',
      });
    });

    it('should throw NOT_YET_FIRING when pending', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'pending', is_open: true }));

      await expect(AlertV2.acknowledge(String(alert._id), 'user_admin')).rejects.toMatchObject({
        code: 'NOT_YET_FIRING',
      });
    });

    it('should return null for an unknown id', async () => {
      const result = await AlertV2.acknowledge('507f1f77bcf86cd799439011', 'user_admin');
      expect(result).toBeNull();
    });
  });

  describe('resolve', () => {
    it('should resolve a firing alert and flip is_open to false', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

      const resolved = await AlertV2.resolve(String(alert._id), 'user_admin');

      expect(resolved!.status).toBe('resolved');
      expect(resolved!.audit.resolution).toBe('manual');
      expect(resolved!.audit.resolved_by).toBe('user_admin');
      assertIsOpenInvariant(resolved!);
    });

    it('should resolve an acknowledged alert', async () => {
      const alert = await AlertV2.create(
        createAlertInput({ status: 'acknowledged', is_open: true })
      );

      const resolved = await AlertV2.resolve(String(alert._id), 'user_admin');

      expect(resolved!.status).toBe('resolved');
      assertIsOpenInvariant(resolved!);
    });

    it('should record a non-default resolution', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

      const resolved = await AlertV2.resolve(String(alert._id), 'system', 'stale');

      expect(resolved!.audit.resolution).toBe('stale');
    });

    it('should throw ALREADY_RESOLVED when already resolved', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      await expect(AlertV2.resolve(String(alert._id), 'user_admin')).rejects.toMatchObject({
        code: 'ALREADY_RESOLVED',
      });
    });

    it('should throw NOT_YET_FIRING when pending', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'pending', is_open: true }));

      await expect(AlertV2.resolve(String(alert._id), 'user_admin')).rejects.toMatchObject({
        code: 'NOT_YET_FIRING',
      });
    });

    it('should return null for an unknown id', async () => {
      const result = await AlertV2.resolve('507f1f77bcf86cd799439011', 'user_admin');
      expect(result).toBeNull();
    });
  });
});
```

Append to `__tests__/setup/factories.ts`:

```typescript
// ============================================================================
// ALERT FACTORIES
// ============================================================================

export interface AlertInput {
  // Must be Types.ObjectId, not `unknown`: `unknown` collapses to `never`
  // against Mongoose's create() overloads and cascades type errors.
  rule_id: Types.ObjectId;
  rule_name: string;
  device_id: string;
  status: 'pending' | 'firing' | 'acknowledged' | 'resolved';
  is_open: boolean;
  severity: 'info' | 'warning' | 'critical';
  metric: string;
  comparison: string;
  threshold: number;
  trigger_value: number;
  last_value: number;
  breached_since: Date;
  last_observed_at: Date;
  fired_at?: Date;
  audit?: Record<string, unknown>;
}

let alertCounter = 0;

export function createAlertInput(overrides: Partial<AlertInput> = {}): AlertInput {
  alertCounter += 1;
  const now = new Date();
  const status = overrides.status ?? 'firing';
  return {
    rule_id: new Types.ObjectId(),
    rule_name: `Test Rule ${alertCounter}`,
    device_id: `device_${String(alertCounter).padStart(3, '0')}`,
    status,
    is_open: status !== 'resolved',
    severity: 'warning',
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    trigger_value: 35,
    last_value: 35,
    breached_since: now,
    last_observed_at: now,
    fired_at: status === 'pending' ? undefined : now,
    audit: {
      created_at: now,
      created_by: 'system',
      updated_at: now,
      updated_by: 'system',
      ...(status === 'resolved'
        ? { resolved_at: now, resolved_by: 'system', resolution: 'auto' }
        : {}),
    },
    ...overrides,
  };
}
```

`createAlertInput` uses `Types` — add `import { Types } from 'mongoose';` at the top of `factories.ts` if it is not already imported. Add `alertCounter = 0;` to `resetCounters()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/models/AlertV2.test.ts`
Expected: FAIL — `Cannot find module '@/models/v2/AlertV2'`

- [ ] **Step 3: Write the model**

Create `models/v2/AlertV2.ts`:

```typescript
// Type-only `Types` import: this file uses Types.ObjectId as a field TYPE and
// Schema.Types.ObjectId as the schema value — it never calls `new Types.…`.
import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type { AlertMetric, AlertComparison, AlertSeverity } from './AlertRuleV2';

// ============================================================================
// CUSTOM ERRORS
// ============================================================================

/**
 * Three codes, not four. ScheduleV2 needs four because its two terminal targets
 * are symmetric — either can block the other. Alerts are not symmetric:
 * `acknowledged` sits between `firing` and `resolved`.
 */
export type AlertTransitionCode =
  | 'ALREADY_ACKNOWLEDGED'
  | 'ALREADY_RESOLVED'
  | 'NOT_YET_FIRING';

export class AlertTransitionError extends Error {
  code: AlertTransitionCode;

  constructor(code: AlertTransitionCode, message: string) {
    super(message);
    this.name = 'AlertTransitionError';
    this.code = code;
  }
}

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

export type AlertStatus = 'pending' | 'firing' | 'acknowledged' | 'resolved';
export type AlertResolution = 'manual' | 'auto' | 'stale' | 'device_inactive';

export interface IAlertAudit {
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  acknowledged_at?: Date;
  acknowledged_by?: string;
  resolved_at?: Date;
  resolved_by?: string;
  resolution?: AlertResolution;
  note?: string;
}

/**
 * One document per *episode*: a continuous stretch during which one rule is
 * breached on one device.
 */
export interface IAlertV2 {
  _id: Types.ObjectId;
  rule_id: Types.ObjectId;
  /** Denormalized so history survives a rule rename or soft delete. */
  rule_name: string;
  device_id: string;

  status: AlertStatus;
  /**
   * Invariant: is_open === (status !== 'resolved').
   *
   * Denormalized because the dedup index needs an equality predicate — a
   * `status: { $in: [...] }` partialFilterExpression would require MongoDB 6.0+.
   * Maintained in exactly four places: the evaluator's bulk write,
   * `acknowledge` (leaves it true), `resolve` (sets it false), and the sweep.
   */
  is_open: boolean;
  severity: AlertSeverity;

  // Condition snapshot — an alert is self-describing even if the rule later changes.
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;

  trigger_value: number;
  last_value: number;
  resolved_value?: number;

  /** First breach of this episode — drives for_duration_seconds. */
  breached_since: Date;
  /** Most recent evaluated reading — drives staleness, moves only forward. */
  last_observed_at: Date;
  fired_at?: Date;

  audit: IAlertAudit;
}

// ============================================================================
// MONGOOSE SCHEMA
// ============================================================================

const AuditSchema = new Schema<IAlertAudit>(
  {
    created_at: { type: Date, default: () => new Date() },
    created_by: { type: String, required: true },
    updated_at: { type: Date, default: () => new Date() },
    updated_by: { type: String, required: true },
    acknowledged_at: { type: Date },
    acknowledged_by: { type: String },
    resolved_at: { type: Date },
    resolved_by: { type: String },
    resolution: {
      type: String,
      enum: ['manual', 'auto', 'stale', 'device_inactive'],
    },
    note: { type: String, maxlength: 1000 },
  },
  { _id: false }
);

const AlertV2Schema = new Schema<IAlertV2>(
  {
    rule_id: { type: Schema.Types.ObjectId, required: true },
    rule_name: { type: String, required: true },
    device_id: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'firing', 'acknowledged', 'resolved'],
      required: true,
    },
    is_open: { type: Boolean, required: true },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      required: true,
    },

    metric: {
      type: String,
      enum: ['value', 'anomaly_score', 'battery_level'],
      required: true,
    },
    comparison: {
      type: String,
      enum: ['gt', 'gte', 'lt', 'lte'],
      required: true,
    },
    threshold: { type: Number, required: true },

    trigger_value: { type: Number, required: true },
    last_value: { type: Number, required: true },
    resolved_value: { type: Number },

    breached_since: { type: Date, required: true },
    last_observed_at: { type: Date, required: true },
    fired_at: { type: Date },

    audit: { type: AuditSchema, required: true },
  },
  {
    collection: 'alerts_v2',
    timestamps: false,
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// Deduplication: at most one OPEN episode per (rule, device) pair, enforced by
// MongoDB rather than by application logic. The partial filter is what allows
// unlimited *resolved* episodes for the same pair.
AlertV2Schema.index(
  { rule_id: 1, device_id: 1 },
  { unique: true, partialFilterExpression: { is_open: true } }
);

// Cooldown lookback. NOT optional: the partial unique index above is only usable
// by queries matching its filter, so a lookback over resolved episodes cannot use
// it, and there is no other { rule_id, device_id } index to fall back on.
AlertV2Schema.index({ rule_id: 1, device_id: 1, 'audit.resolved_at': -1 });

// Active list — the default view.
AlertV2Schema.index({ status: 1, 'audit.created_at': -1 });

// Device detail page.
AlertV2Schema.index({ device_id: 1, 'audit.created_at': -1 });

// Severity filter.
AlertV2Schema.index({ severity: 1, status: 1 });

// Staleness sweep.
AlertV2Schema.index({ is_open: 1, last_observed_at: 1 });

// ============================================================================
// MIDDLEWARE
// ============================================================================

AlertV2Schema.pre('save', function () {
  if (!this.isNew) this.audit.updated_at = new Date();
});

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Acknowledge a firing alert (atomic). Acknowledged alerts never return to
 * firing: re-firing under a human already working the problem is noise.
 */
AlertV2Schema.statics.acknowledge = async function (id: string, by: string) {
  const now = new Date();
  const result = await this.findOneAndUpdate(
    { _id: id, status: 'firing' },
    {
      $set: {
        status: 'acknowledged',
        is_open: true,
        'audit.updated_at': now,
        'audit.updated_by': by,
        'audit.acknowledged_at': now,
        'audit.acknowledged_by': by,
      },
    },
    { new: true }
  );

  if (!result) {
    const existing = await this.findById(id);
    if (!existing) return null;
    if (existing.status === 'acknowledged')
      throw new AlertTransitionError('ALREADY_ACKNOWLEDGED', 'Alert is already acknowledged');
    if (existing.status === 'resolved')
      throw new AlertTransitionError('ALREADY_RESOLVED', 'Alert is already resolved');
    throw new AlertTransitionError('NOT_YET_FIRING', 'Alert has not fired yet');
  }

  return result;
};

/**
 * Resolve a firing or acknowledged alert (atomic). `resolved` is terminal.
 */
AlertV2Schema.statics.resolve = async function (
  id: string,
  by: string,
  resolution: AlertResolution = 'manual'
) {
  const now = new Date();
  const result = await this.findOneAndUpdate(
    { _id: id, status: { $in: ['firing', 'acknowledged'] } },
    {
      $set: {
        status: 'resolved',
        is_open: false,
        'audit.updated_at': now,
        'audit.updated_by': by,
        'audit.resolved_at': now,
        'audit.resolved_by': by,
        'audit.resolution': resolution,
      },
    },
    { new: true }
  );

  if (!result) {
    const existing = await this.findById(id);
    if (!existing) return null;
    if (existing.status === 'resolved')
      throw new AlertTransitionError('ALREADY_RESOLVED', 'Alert is already resolved');
    throw new AlertTransitionError('NOT_YET_FIRING', 'Alert has not fired yet');
  }

  return result;
};

// ============================================================================
// INTERFACE FOR STATIC METHODS
// ============================================================================

export interface IAlertV2Model extends Model<IAlertV2> {
  acknowledge(id: string, by: string): Promise<(IAlertV2 & Document) | null>;
  resolve(
    id: string,
    by: string,
    resolution?: AlertResolution
  ): Promise<(IAlertV2 & Document) | null>;
}

// ============================================================================
// MODEL EXPORT
// ============================================================================

const AlertV2 =
  (mongoose.models.AlertV2 as unknown as IAlertV2Model) ||
  mongoose.model<IAlertV2, IAlertV2Model>('AlertV2', AlertV2Schema);

export default AlertV2;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/models/AlertV2.test.ts`
Expected: PASS, 16 tests. If the two dedup-index tests fail with "expected rejection", confirm `await AlertV2.init()` runs before the inserts — mongodb-memory-server does not build indexes until the model is initialized.

- [ ] **Step 5: Add the error codes**

In `lib/errors/errorCodes.ts`, add a block to the `ErrorCodes` object immediately after the `// ---- Schedule Errors (404, 422) ----` block:

```typescript
  // ---- Alert Errors (404, 422) ----
  ALERT_NOT_FOUND: 'ALERT_NOT_FOUND',
  ALERT_RULE_NOT_FOUND: 'ALERT_RULE_NOT_FOUND',
  ALERT_ALREADY_ACKNOWLEDGED: 'ALERT_ALREADY_ACKNOWLEDGED',
  ALERT_ALREADY_RESOLVED: 'ALERT_ALREADY_RESOLVED',
  INVALID_ALERT_STATUS_TRANSITION: 'INVALID_ALERT_STATUS_TRANSITION',
```

And the matching registry entries after the schedule entries in `ErrorCodeRegistry`:

```typescript
  // ---- Alert Errors ----
  [ErrorCodes.ALERT_NOT_FOUND]: {
    code: ErrorCodes.ALERT_NOT_FOUND,
    statusCode: 404,
    description: 'The specified alert was not found',
  },
  [ErrorCodes.ALERT_RULE_NOT_FOUND]: {
    code: ErrorCodes.ALERT_RULE_NOT_FOUND,
    statusCode: 404,
    description: 'The specified alert rule was not found',
  },
  [ErrorCodes.ALERT_ALREADY_ACKNOWLEDGED]: {
    code: ErrorCodes.ALERT_ALREADY_ACKNOWLEDGED,
    statusCode: 422,
    description: 'The alert has already been acknowledged',
  },
  [ErrorCodes.ALERT_ALREADY_RESOLVED]: {
    code: ErrorCodes.ALERT_ALREADY_RESOLVED,
    statusCode: 422,
    description: 'The alert has already been resolved and cannot be modified',
  },
  [ErrorCodes.INVALID_ALERT_STATUS_TRANSITION]: {
    code: ErrorCodes.INVALID_ALERT_STATUS_TRANSITION,
    statusCode: 422,
    description: 'Invalid alert status transition',
  },
```

- [ ] **Step 6: Run the existing error-code test to confirm nothing regressed**

Run: `pnpm test __tests__/unit/lib/errorCodes.test.ts`
Expected: PASS. `ErrorCodeRegistry` is typed `Record<ErrorCode, ErrorCodeDefinition>`, so a missing registry entry is a compile error, not a runtime one — if this fails to compile, a registry entry is missing.

- [ ] **Step 7: Add the index definitions to the index scripts**

In `scripts/v2/create-indexes-v2.ts`, add:

```typescript
/**
 * AlertV2 Index Definitions
 *
 * The partial unique index is the deduplication mechanism in full — at most one
 * open episode per (rule, device) pair, enforced by MongoDB. It uses an equality
 * predicate on `is_open` (supported since MongoDB 3.2) rather than a status
 * `$in` (which would require 6.0+).
 */
const ALERT_V2_INDEXES: IndexDefinition[] = [
  {
    name: 'rule_device_open_unique',
    spec: { rule_id: 1, device_id: 1 } as IndexSpec,
    options: { unique: true, background: true, partialFilterExpression: { is_open: true } },
    description: 'Partial unique index enforcing one open episode per (rule, device)',
  },
  {
    name: 'rule_device_resolved_at',
    spec: { rule_id: 1, device_id: 1, 'audit.resolved_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Cooldown lookback over resolved episodes',
  },
  {
    name: 'status_created_at',
    spec: { status: 1, 'audit.created_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Active alert list, the default view',
  },
  {
    name: 'device_created_at',
    spec: { device_id: 1, 'audit.created_at': -1 } as IndexSpec,
    options: { background: true },
    description: 'Alerts for a single device',
  },
  {
    name: 'severity_status',
    spec: { severity: 1, status: 1 } as IndexSpec,
    options: { background: true },
    description: 'Severity filter on the alert list',
  },
  {
    name: 'is_open_last_observed_at',
    spec: { is_open: 1, last_observed_at: 1 } as IndexSpec,
    options: { background: true },
    description: 'Staleness sweep',
  },
];
```

`IndexDefinition.options` is currently typed `{ unique?, sparse?, background? }` — widen it to also allow `partialFilterExpression?: Record<string, unknown>` and pass it through to `collection.createIndex` at `scripts/v2/create-indexes-v2.ts:205`. Register `ALERT_V2_INDEXES` against collection `alerts_v2` inside `createIndexes()`, and mirror the additions in `scripts/v2/verify-indexes.ts`.

- [ ] **Step 8: Verify everything typechecks and the suite is green**

Run: `npx tsc --noEmit && pnpm test __tests__/unit/models`
Expected: no type errors; all model tests pass.

- [ ] **Step 9: Commit**

```bash
git add models/v2/AlertV2.ts __tests__/unit/models/AlertV2.test.ts __tests__/setup/factories.ts lib/errors/errorCodes.ts scripts/v2/create-indexes-v2.ts scripts/v2/verify-indexes.ts
git commit -m "feat(alerting): add AlertV2 model with index-enforced deduplication"
```

---

### Task 3: Validation schemas and client-safe wire types

**Files:**
- Create: `lib/validations/v2/alert-rule.validation.ts`
- Create: `lib/validations/v2/alert.validation.ts`
- Create: `types/v2/alert.types.ts`
- Modify: `types/v2/index.ts`
- Test: `__tests__/unit/validations/alert-rule.validation.test.ts`
- Test: `__tests__/unit/validations/alert.validation.test.ts`

**Design decision this task pins down (not spelled out in the spec):** on `PATCH /api/v2/alert-rules/[id]`, the fields `metric`, `comparison`, `threshold`, and `selector` form an **atomic group**. If any one of them is present, all four must be. Without this, the two cross-field refinements are undecidable at the edge — you cannot check "threshold within `metric`'s bounds" when only `threshold` was sent. Everything else (`name`, `description`, `enabled`, `severity`, `for_duration_seconds`, `cooldown_seconds`) is freely partial.

**Interfaces:**
- Consumes: `READING_TYPES` from `@/models/v2/AlertRuleV2` (Task 1); shared helpers from `lib/validations/common.validation.ts` — `objectIdSchema`, `deviceIdSchema`, `buildingIdSchema`, `floorSchema`, `zoneSchema`, `paginationSchema`, `dateRangeSchema`, `createSortSchema`.
- Produces (validation):
  - `alertMetricSchema`, `alertComparisonSchema`, `alertSeveritySchema`, `alertStatusSchema`, `readingTypeSchema`, `alertRuleSelectorSchema`
  - `createAlertRuleSchema`, `updateAlertRuleSchema`, `listAlertRulesQuerySchema`, `alertRuleIdParamSchema`
  - `updateAlertSchema`, `listAlertsQuerySchema`, `getAlertQuerySchema`, `alertIdParamSchema`
  - Inferred types: `CreateAlertRuleInput`, `UpdateAlertRuleInput`, `ListAlertRulesQuery`, `UpdateAlertInput`, `ListAlertsQuery`, `GetAlertQuery`
- Produces (wire types, **no mongoose imports** — `lib/pusher-context.tsx` imports from here):
  - `AlertMetric`, `AlertComparison`, `AlertSeverity`, `AlertStatus`, `AlertResolution`, `AlertRuleSelector`
  - `AlertRuleV2Response`, `AlertV2Response`, `FiredAlert`, `ResolvedAlert`, `AlertEvent`

- [ ] **Step 1: Write the failing rule-validation test**

Create `__tests__/unit/validations/alert-rule.validation.test.ts`:

```typescript
/**
 * Alert Rule Validation Schema Tests
 */

import {
  createAlertRuleSchema,
  updateAlertRuleSchema,
  listAlertRulesQuerySchema,
} from '@/lib/validations/v2/alert-rule.validation';

function validRule(overrides: Record<string, unknown> = {}) {
  return {
    name: 'High temperature',
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    severity: 'critical',
    selector: { types: ['temperature'] },
    ...overrides,
  };
}

describe('createAlertRuleSchema', () => {
  it('should accept a minimal valid rule and apply defaults', () => {
    const result = createAlertRuleSchema.safeParse(validRule());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.for_duration_seconds).toBe(0);
      expect(result.data.cooldown_seconds).toBe(300);
    }
  });

  it("should require selector.types when metric is 'value'", () => {
    const result = createAlertRuleSchema.safeParse(validRule({ selector: {} }));

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.some(i => i.path.join('.') === 'selector.types')).toBe(true);
  });

  it("should reject an empty selector.types array when metric is 'value'", () => {
    const result = createAlertRuleSchema.safeParse(validRule({ selector: { types: [] } }));
    expect(result.success).toBe(false);
  });

  it('should allow anomaly_score rules with no selector.types', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ metric: 'anomaly_score', threshold: 0.8, selector: {} })
    );
    expect(result.success).toBe(true);
  });

  it('should allow battery_level rules with no selector.types', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ metric: 'battery_level', comparison: 'lt', threshold: 20, selector: {} })
    );
    expect(result.success).toBe(true);
  });

  it('should bound anomaly_score thresholds to 0-1', () => {
    const tooHigh = createAlertRuleSchema.safeParse(
      validRule({ metric: 'anomaly_score', threshold: 30, selector: {} })
    );
    const negative = createAlertRuleSchema.safeParse(
      validRule({ metric: 'anomaly_score', threshold: -0.1, selector: {} })
    );

    expect(tooHigh.success).toBe(false);
    expect(negative.success).toBe(false);
  });

  it('should bound battery_level thresholds to 0-100', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ metric: 'battery_level', comparison: 'lt', threshold: 101, selector: {} })
    );
    expect(result.success).toBe(false);
  });

  it('should leave value thresholds unconstrained', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ threshold: -273.15, selector: { types: ['temperature'] } })
    );
    expect(result.success).toBe(true);
  });

  it('should reject an unknown reading type in the selector', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({ selector: { types: ['plasma'] } })
    );
    expect(result.success).toBe(false);
  });

  it('should cap for_duration_seconds and cooldown_seconds at 86400', () => {
    expect(createAlertRuleSchema.safeParse(validRule({ for_duration_seconds: 86401 })).success).toBe(false);
    expect(createAlertRuleSchema.safeParse(validRule({ cooldown_seconds: 86401 })).success).toBe(false);
  });

  it('should accept the full selector shape', () => {
    const result = createAlertRuleSchema.safeParse(
      validRule({
        selector: {
          types: ['temperature', 'humidity'],
          building_id: 'HQ',
          floor: 3,
          zone: 'north',
          tags: ['critical', 'hvac'],
        },
      })
    );
    expect(result.success).toBe(true);
  });
});

describe('updateAlertRuleSchema', () => {
  it('should accept a partial update of non-condition fields', () => {
    const result = updateAlertRuleSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
  });

  it('should reject an empty update', () => {
    const result = updateAlertRuleSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject a partial condition update', () => {
    const result = updateAlertRuleSchema.safeParse({ threshold: 40 });
    expect(result.success).toBe(false);
  });

  it('should accept a complete condition update', () => {
    const result = updateAlertRuleSchema.safeParse({
      metric: 'value',
      comparison: 'gte',
      threshold: 40,
      selector: { types: ['temperature'] },
    });
    expect(result.success).toBe(true);
  });

  it('should apply the metric threshold bounds to a complete condition update', () => {
    const result = updateAlertRuleSchema.safeParse({
      metric: 'anomaly_score',
      comparison: 'gt',
      threshold: 5,
      selector: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('listAlertRulesQuerySchema', () => {
  it('should coerce string pagination params', () => {
    const result = listAlertRulesQuerySchema.safeParse({ page: '2', limit: '50' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(50);
    }
  });

  it('should coerce the enabled flag from a string', () => {
    const result = listAlertRulesQuerySchema.safeParse({ enabled: 'false' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(false);
  });

  it('should reject an unknown sort field', () => {
    const result = listAlertRulesQuerySchema.safeParse({ sortBy: 'nonsense' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/validations/alert-rule.validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the rule validation schema**

Create `lib/validations/v2/alert-rule.validation.ts`:

```typescript
import { z } from 'zod';
import { READING_TYPES } from '@/models/v2/AlertRuleV2';
import {
  buildingIdSchema,
  floorSchema,
  zoneSchema,
  paginationSchema,
  createSortSchema,
} from '../common.validation';

// ============================================================================
// ENUMS
// ============================================================================

// The cast must preserve the literal union, not widen to `string`. Casting to
// `[string, ...string[]]` makes z.infer produce `string[]` for selector.types,
// which then will not assign to IAlertRuleSelector.types (ReadingType[]) and
// breaks the alert-rule routes at compile time.
export const readingTypeSchema = z.enum(
  READING_TYPES as unknown as [(typeof READING_TYPES)[number], ...(typeof READING_TYPES)[number][]]
);
export const alertMetricSchema = z.enum(['value', 'anomaly_score', 'battery_level']);
export const alertComparisonSchema = z.enum(['gt', 'gte', 'lt', 'lte']);
export const alertSeveritySchema = z.enum(['info', 'warning', 'critical']);

// ============================================================================
// SELECTOR
// ============================================================================

/**
 * Every dimension is optional; an absent dimension means "no constraint".
 * A device must satisfy ALL present dimensions, and carry ALL listed tags.
 */
export const alertRuleSelectorSchema = z
  .object({
    types: z.array(readingTypeSchema).max(15).optional(),
    building_id: buildingIdSchema.optional(),
    floor: floorSchema.optional(),
    zone: zoneSchema,
    tags: z
      .array(
        z
          .string()
          .min(1, 'Tag cannot be empty')
          .max(50, 'Tag must be 50 characters or less')
          .regex(/^[a-zA-Z0-9_-]+$/, 'Tags can only contain alphanumeric characters, underscores, and hyphens')
      )
      .max(20, 'Cannot have more than 20 tags')
      .optional(),
  })
  .strict();

// ============================================================================
// CROSS-FIELD REFINEMENTS
// ============================================================================

interface ConditionShape {
  metric: 'value' | 'anomaly_score' | 'battery_level';
  threshold: number;
  selector: z.infer<typeof alertRuleSelectorSchema>;
}

/**
 * A bare value threshold across mixed units is meaningless — 30 is a reasonable
 * temperature ceiling and an absurd power one. anomaly_score and battery_level
 * are unit-free and meaningful fleet-wide, so they may omit `types`.
 */
function typesRequiredForValueMetric(data: ConditionShape): boolean {
  if (data.metric !== 'value') return true;
  return (data.selector?.types?.length ?? 0) > 0;
}

/** Reject a rule that can never fire, at the edge rather than at evaluation. */
function thresholdWithinMetricBounds(data: ConditionShape): boolean {
  if (data.metric === 'anomaly_score') return data.threshold >= 0 && data.threshold <= 1;
  if (data.metric === 'battery_level') return data.threshold >= 0 && data.threshold <= 100;
  return true;
}

const TYPES_REQUIRED_MESSAGE = "selector.types must list at least one reading type when metric is 'value'";
const THRESHOLD_BOUNDS_MESSAGE =
  'threshold is outside the valid range for this metric (anomaly_score: 0-1, battery_level: 0-100)';

// ============================================================================
// CREATE
// ============================================================================

export const createAlertRuleSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or less'),
    description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
    enabled: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(true),
    selector: alertRuleSelectorSchema.default({}),
    metric: alertMetricSchema,
    comparison: alertComparisonSchema,
    threshold: z.number(),
    for_duration_seconds: z
      .number()
      .int('for_duration_seconds must be an integer')
      .min(0)
      .max(86400, 'for_duration_seconds cannot exceed 24 hours')
      .default(0),
    severity: alertSeveritySchema,
    cooldown_seconds: z
      .number()
      .int('cooldown_seconds must be an integer')
      .min(0)
      .max(86400, 'cooldown_seconds cannot exceed 24 hours')
      .default(300),
  })
  .refine(thresholdWithinMetricBounds, {
    message: THRESHOLD_BOUNDS_MESSAGE,
    path: ['threshold'],
  })
  .refine(typesRequiredForValueMetric, {
    message: TYPES_REQUIRED_MESSAGE,
    path: ['selector', 'types'],
  });

// ============================================================================
// UPDATE
// ============================================================================

/**
 * `metric`, `comparison`, `threshold` and `selector` form an atomic group: if any
 * is present, all must be. Otherwise the cross-field refinements above are
 * undecidable — you cannot bound a threshold without knowing its metric.
 */
const CONDITION_FIELDS = ['metric', 'comparison', 'threshold', 'selector'] as const;

export const updateAlertRuleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    enabled: z.union([z.boolean(), z.string().transform(v => v === 'true')]).optional(),
    selector: alertRuleSelectorSchema.optional(),
    metric: alertMetricSchema.optional(),
    comparison: alertComparisonSchema.optional(),
    threshold: z.number().optional(),
    for_duration_seconds: z.number().int().min(0).max(86400).optional(),
    severity: alertSeveritySchema.optional(),
    cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  })
  .refine(
    data => Object.values(data).some(v => v !== undefined),
    'At least one field must be provided for update'
  )
  .refine(
    data => {
      const present = CONDITION_FIELDS.filter(f => data[f] !== undefined);
      return present.length === 0 || present.length === CONDITION_FIELDS.length;
    },
    {
      message:
        'metric, comparison, threshold and selector must be updated together — send all four or none',
      path: ['metric'],
    }
  )
  .refine(
    data =>
      data.metric === undefined ||
      thresholdWithinMetricBounds(data as unknown as ConditionShape),
    { message: THRESHOLD_BOUNDS_MESSAGE, path: ['threshold'] }
  )
  .refine(
    data =>
      data.metric === undefined ||
      typesRequiredForValueMetric(data as unknown as ConditionShape),
    { message: TYPES_REQUIRED_MESSAGE, path: ['selector', 'types'] }
  );

// ============================================================================
// QUERY
// ============================================================================

const alertRuleSortFields = ['name', 'created_at', 'updated_at', 'severity'] as const;

export const listAlertRulesQuerySchema = z.object({
  ...paginationSchema.shape,
  ...createSortSchema(alertRuleSortFields).shape,
  enabled: z.union([z.boolean(), z.string().transform(v => v === 'true')]).optional(),
  metric: alertMetricSchema.optional(),
  severity: alertSeveritySchema.optional(),
});

export const alertRuleIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid alert rule ID format'),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
export type ListAlertRulesQuery = z.infer<typeof listAlertRulesQuerySchema>;
export type AlertRuleSelectorInput = z.infer<typeof alertRuleSelectorSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/validations/alert-rule.validation.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Write the failing alert-validation test**

Create `__tests__/unit/validations/alert.validation.test.ts`:

```typescript
/**
 * Alert Validation Schema Tests
 */

import {
  updateAlertSchema,
  listAlertsQuerySchema,
  getAlertQuerySchema,
  alertIdParamSchema,
} from '@/lib/validations/v2/alert.validation';

describe('updateAlertSchema', () => {
  it('should accept acknowledged', () => {
    expect(updateAlertSchema.safeParse({ status: 'acknowledged' }).success).toBe(true);
  });

  it('should accept resolved with a note', () => {
    const result = updateAlertSchema.safeParse({ status: 'resolved', note: 'Replaced sensor' });
    expect(result.success).toBe(true);
  });

  it('should reject pending and firing as PATCH targets', () => {
    expect(updateAlertSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(updateAlertSchema.safeParse({ status: 'firing' }).success).toBe(false);
  });

  it('should require a status', () => {
    expect(updateAlertSchema.safeParse({ note: 'no status' }).success).toBe(false);
  });

  it('should cap the note at 1000 characters', () => {
    const result = updateAlertSchema.safeParse({ status: 'resolved', note: 'x'.repeat(1001) });
    expect(result.success).toBe(false);
  });
});

describe('listAlertsQuerySchema', () => {
  it('should accept a comma-separated status list', () => {
    const result = listAlertsQuerySchema.safeParse({ status: 'firing,acknowledged' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toEqual(['firing', 'acknowledged']);
  });

  it('should accept a single severity', () => {
    const result = listAlertsQuerySchema.safeParse({ severity: 'critical' });
    expect(result.success).toBe(true);
  });

  it('should reject an unknown status', () => {
    expect(listAlertsQuerySchema.safeParse({ status: 'smouldering' }).success).toBe(false);
  });

  it('should validate rule_id as an ObjectId', () => {
    expect(listAlertsQuerySchema.safeParse({ rule_id: 'not-an-objectid' }).success).toBe(false);
    expect(listAlertsQuerySchema.safeParse({ rule_id: '507f1f77bcf86cd799439011' }).success).toBe(true);
  });

  it('should reject a start date after the end date', () => {
    const result = listAlertsQuerySchema.safeParse({
      startDate: '2026-08-02T00:00:00.000Z',
      endDate: '2026-08-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('getAlertQuerySchema', () => {
  it('should default include_device to false', () => {
    const result = getAlertQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.include_device).toBe(false);
  });

  it('should coerce include_device from a string', () => {
    const result = getAlertQuerySchema.safeParse({ include_device: 'true' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.include_device).toBe(true);
  });
});

describe('alertIdParamSchema', () => {
  it('should reject a malformed id', () => {
    expect(alertIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});
```

- [ ] **Step 6: Write the alert validation schema**

Create `lib/validations/v2/alert.validation.ts`:

```typescript
import { z } from 'zod';
import {
  deviceIdSchema,
  objectIdSchema,
  paginationSchema,
  dateRangeSchema,
  createSortSchema,
} from '../common.validation';
import { alertSeveritySchema } from './alert-rule.validation';

// ============================================================================
// ENUMS
// ============================================================================

export const alertStatusSchema = z.enum(['pending', 'firing', 'acknowledged', 'resolved']);
export const alertResolutionSchema = z.enum(['manual', 'auto', 'stale', 'device_inactive']);

// ============================================================================
// UPDATE (PATCH /api/v2/alerts/:id)
// ============================================================================

/**
 * The only transitions a human can drive. `pending` is internal and `firing` is
 * system-generated, so neither is a legal PATCH target.
 */
export const updateAlertSchema = z.object({
  status: z.enum(['acknowledged', 'resolved']),
  note: z.string().max(1000, 'Note must be 1000 characters or less').optional(),
});

// ============================================================================
// QUERY
// ============================================================================

const alertSortFields = [
  'created_at',
  'fired_at',
  'severity',
  'status',
  'last_observed_at',
] as const;

// The multi-value unions are written out inline rather than extracted into a
// generic `multiValue<T extends z.ZodTypeAny>(inner: T)` helper: under Zod 4 the
// generic form loses the inner literal types and fails typecheck. Inline is also
// exactly what `schedule.validation.ts` does for its status/service_type filters.
//
// `dateRangeSchema`'s ordering check lives on the schema as a `.refine()`, and
// spreading `.shape` drops it — hence the `.refine()` re-added at the end.
export const listAlertsQuerySchema = z
  .object({
    ...paginationSchema.shape,
    ...createSortSchema(alertSortFields).shape,
    ...dateRangeSchema.shape,
    // Accepts `firing`, `['firing','acknowledged']`, or `'firing,acknowledged'`.
    status: z
      .union([
        alertStatusSchema,
        z.array(alertStatusSchema),
        z
          .string()
          .transform(val => val.split(',').map(s => s.trim()).filter(Boolean))
          .pipe(z.array(alertStatusSchema)),
      ])
      .optional(),
    severity: z
      .union([
        alertSeveritySchema,
        z.array(alertSeveritySchema),
        z
          .string()
          .transform(val => val.split(',').map(s => s.trim()).filter(Boolean))
          .pipe(z.array(alertSeveritySchema)),
      ])
      .optional(),
    device_id: deviceIdSchema.optional(),
    rule_id: objectIdSchema.optional(),
  })
  .refine(
    data => !(data.startDate && data.endDate) || data.startDate <= data.endDate,
    { message: 'Start date must be before or equal to end date', path: ['endDate'] }
  );

export const getAlertQuerySchema = z.object({
  include_device: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(false),
});

export const alertIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid alert ID format'),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
export type GetAlertQuery = z.infer<typeof getAlertQuerySchema>;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test __tests__/unit/validations/alert.validation.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 8: Write the client-safe wire types**

Create `types/v2/alert.types.ts`. **This file must not import from `mongoose` or `models/`** — `lib/pusher-context.tsx` is a `'use client'` module and imports `AlertEvent` from here.

```typescript
/**
 * TypeScript Type Definitions for the Alerting Subsystem
 *
 * Client-safe: no mongoose or model imports. `lib/pusher-context.tsx` imports
 * AlertEvent from this file.
 *
 * Aligned with:
 * - Mongoose models: /models/v2/AlertRuleV2.ts, /models/v2/AlertV2.ts
 * - Zod schemas: /lib/validations/v2/alert-rule.validation.ts, alert.validation.ts
 */

// ============================================================================
// ENUMS
// ============================================================================

export type AlertMetric = 'value' | 'anomaly_score' | 'battery_level';
export type AlertComparison = 'gt' | 'gte' | 'lt' | 'lte';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'pending' | 'firing' | 'acknowledged' | 'resolved';
export type AlertResolution = 'manual' | 'auto' | 'stale' | 'device_inactive';
export type ReadingTypeName =
  | 'temperature' | 'humidity' | 'occupancy' | 'power' | 'co2'
  | 'pressure' | 'light' | 'motion' | 'air_quality' | 'water_flow'
  | 'gas' | 'vibration' | 'voltage' | 'current' | 'energy';

// ============================================================================
// RULE
// ============================================================================

export interface AlertRuleSelector {
  types?: ReadingTypeName[];
  building_id?: string;
  floor?: number;
  zone?: string;
  tags?: string[];
}

export interface AlertRuleAudit {
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  deleted_at?: string;
  deleted_by?: string;
}

/** A rule as returned by the API (dates serialized to ISO strings). */
export interface AlertRuleV2Response {
  _id: string;
  name: string;
  description?: string;
  enabled: boolean;
  selector: AlertRuleSelector;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;
  for_duration_seconds: number;
  severity: AlertSeverity;
  cooldown_seconds: number;
  audit: AlertRuleAudit;
}

export interface CreateAlertRuleBody {
  name: string;
  description?: string;
  enabled?: boolean;
  selector?: AlertRuleSelector;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;
  for_duration_seconds?: number;
  severity: AlertSeverity;
  cooldown_seconds?: number;
}

export type UpdateAlertRuleBody = Partial<CreateAlertRuleBody>;

export interface ListAlertRulesQueryParams {
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'created_at' | 'updated_at' | 'severity';
  sortDirection?: 'asc' | 'desc';
  enabled?: boolean;
  metric?: AlertMetric;
  severity?: AlertSeverity;
}

// ============================================================================
// ALERT
// ============================================================================

export interface AlertAudit {
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution?: AlertResolution;
  note?: string;
}

/** An alert as returned by the API (dates serialized to ISO strings). */
export interface AlertV2Response {
  _id: string;
  rule_id: string;
  rule_name: string;
  device_id: string;
  status: AlertStatus;
  is_open: boolean;
  severity: AlertSeverity;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;
  trigger_value: number;
  last_value: number;
  resolved_value?: number;
  breached_since: string;
  last_observed_at: string;
  fired_at?: string;
  audit: AlertAudit;
  /** Present only when `include_device=true`. */
  device?: {
    _id: string;
    serial_number: string;
    type: string;
    location: { building_id?: string; floor?: number; room_name?: string };
  } | null;
}

export interface UpdateAlertBody {
  status: 'acknowledged' | 'resolved';
  note?: string;
}

export interface ListAlertsQueryParams {
  page?: number;
  limit?: number;
  sortBy?: 'created_at' | 'fired_at' | 'severity' | 'status' | 'last_observed_at';
  sortDirection?: 'asc' | 'desc';
  status?: AlertStatus | AlertStatus[];
  severity?: AlertSeverity | AlertSeverity[];
  device_id?: string;
  rule_id?: string;
  startDate?: string;
  endDate?: string;
}

// ============================================================================
// PUSHER WIRE TYPES
// ============================================================================

/** Trimmed payload broadcast when an episode starts firing. */
export interface FiredAlert {
  _id: string;
  rule_id: string;
  rule_name: string;
  device_id: string;
  severity: AlertSeverity;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: number;
  trigger_value: number;
  fired_at: string;
}

/**
 * Trimmed payload broadcast when an episode resolves.
 * `actor` is 'system' for automatic resolution, otherwise the Clerk USER ID.
 * Never an email — this payload reaches every connected client.
 */
export interface ResolvedAlert {
  _id: string;
  rule_id: string;
  device_id: string;
  severity: AlertSeverity;
  resolution: AlertResolution;
  resolved_at: string;
  actor: string;
}

/**
 * All alert traffic arrives on the single `alert-event` Pusher event name.
 * The tag is carried in the payload because PusherContext holds one callback
 * set bound to one event name — a subscriber receiving a bare array could not
 * tell which event produced it.
 */
export type AlertEvent =
  | { kind: 'fired'; alerts: FiredAlert[] }
  | { kind: 'resolved'; alerts: ResolvedAlert[] }
  | {
      kind: 'storm';
      count: number;
      by_severity: Record<AlertSeverity, number>;
      since: string;
    };
```

- [ ] **Step 9: Re-export from the types barrel**

Append to `types/v2/index.ts`:

```typescript
// ============================================================================
// ALERT TYPES
// ============================================================================

export type {
  // Enums
  AlertMetric,
  AlertComparison,
  AlertSeverity,
  AlertStatus,
  AlertResolution,
  ReadingTypeName,
  // Rule
  AlertRuleSelector,
  AlertRuleAudit,
  AlertRuleV2Response,
  CreateAlertRuleBody,
  UpdateAlertRuleBody,
  ListAlertRulesQueryParams,
  // Alert
  AlertAudit,
  AlertV2Response,
  UpdateAlertBody,
  ListAlertsQueryParams,
  // Pusher wire types
  FiredAlert,
  ResolvedAlert,
  AlertEvent,
} from './alert.types';
```

- [ ] **Step 10: Verify the whole validation suite and typecheck**

Run: `npx tsc --noEmit && pnpm test __tests__/unit/validations`
Expected: no type errors; all validation tests pass.

- [ ] **Step 11: Commit**

```bash
git add lib/validations/v2/alert-rule.validation.ts lib/validations/v2/alert.validation.ts types/v2/alert.types.ts types/v2/index.ts __tests__/unit/validations/alert-rule.validation.test.ts __tests__/unit/validations/alert.validation.test.ts
git commit -m "feat(alerting): add alert and alert-rule validation schemas and wire types"
```

---

### Task 4: Rule cache key, invalidation, and alert metrics

Shared-infrastructure additions consumed by the evaluator (Tasks 6–8) and by the API routes (Tasks 10–11). Small, but they touch three files other tasks depend on, so they land first and land together.

**Files:**
- Modify: `lib/cache/keys.ts`
- Modify: `lib/cache/invalidation.ts`
- Modify: `lib/cache/index.ts`
- Modify: `lib/monitoring/metrics.ts`
- Modify: `lib/monitoring/index.ts`
- Test: `__tests__/unit/lib/cacheKeys.test.ts` (extend)
- Test: `__tests__/unit/lib/metrics.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CACHE_PREFIXES.ALERT_RULES = 'alert:rules'`
  - `alertRulesKey(): string` — **takes no arguments**
  - `invalidateAlertRules(): Promise<void>`
  - `recordAlert(event: 'fired' | 'resolved' | 'evaluation_error', labels?: { severity?: AlertSeverityLabel; resolution?: string }): void`
  - `recordAlertEvaluationDuration(durationMs: number): void`
  - Prometheus series: `alerts_fired_total{severity}`, `alerts_resolved_total{resolution}`, `alert_evaluation_duration_ms`, `alert_evaluation_errors_total`

- [ ] **Step 1: Write the failing cache-key test**

Append to `__tests__/unit/lib/cacheKeys.test.ts`:

```typescript
describe('alertRulesKey', () => {
  it('should generate a global key with no org prefix', () => {
    expect(alertRulesKey()).toBe('alert:rules:active');
  });

  it('should not accept or embed an org id', () => {
    // The cron path authenticates with SEED_SECRET and has no Clerk context, so
    // there is no orgId to compute. Deliberate departure from orgPrefix.
    expect(alertRulesKey.length).toBe(0);
    expect(alertRulesKey()).not.toContain('org:');
  });
});
```

Add `alertRulesKey` to that file's existing import from `@/lib/cache/keys`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/cacheKeys.test.ts`
Expected: FAIL — `alertRulesKey is not a function`.

- [ ] **Step 3: Add the cache key and invalidation**

In `lib/cache/keys.ts`, add `ALERT_RULES: 'alert:rules',` to `CACHE_PREFIXES`, then append:

```typescript
/**
 * Generate the cache key for the active alert rule set.
 *
 * Deliberately GLOBAL — no orgPrefix, unlike every other generator in this file.
 * Three facts force it:
 *   1. No v2 model carries an org dimension. `orgId` is a Clerk session property
 *      used for cache partitioning, never a stored field, so rules have nothing
 *      to be keyed by.
 *   2. `/api/v2/cron/simulate` authenticates with SEED_SECRET and establishes no
 *      Clerk context at all. On the path that carries every reading in the
 *      deployment, there is no orgId to compute.
 *   3. Multi-tenancy is out of scope; CLERK_ALLOWED_ORG_SLUGS defaults to one org.
 *
 * Giving AlertRuleV2 an org field instead would mean inventing multi-tenancy to
 * serve a cache key.
 */
export function alertRulesKey(): string {
  return `${CACHE_PREFIXES.ALERT_RULES}:active`;
}
```

In `lib/cache/invalidation.ts`, add (importing `alertRulesKey` from `./keys`):

```typescript
// ============================================================================
// ALERT RULE INVALIDATION
// ============================================================================

/**
 * Invalidate the active alert rule cache.
 * Called after every rule create, update, and delete.
 */
export async function invalidateAlertRules(): Promise<void> {
  try {
    await del(alertRulesKey());
    logger.debug('Alert rules cache invalidated');
  } catch (error) {
    logger.warn('Alert rules cache invalidation failed', {}, error as Error);
  }
}
```

In `lib/cache/index.ts`, add `alertRulesKey` to the `./keys` export block and `invalidateAlertRules` to the `./invalidation` export block.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/cacheKeys.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing metrics test**

Append to `__tests__/unit/lib/metrics.test.ts`:

```typescript
describe('recordAlert', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should count fired alerts by severity', () => {
    recordAlert('fired', { severity: 'critical' });
    recordAlert('fired', { severity: 'critical' });
    recordAlert('fired', { severity: 'warning' });

    const prom = getPrometheusMetrics();

    expect(prom).toContain('alerts_fired_total{severity="critical"} 2');
    expect(prom).toContain('alerts_fired_total{severity="warning"} 1');
  });

  it('should count resolved alerts by resolution', () => {
    recordAlert('resolved', { resolution: 'auto' });
    recordAlert('resolved', { resolution: 'stale' });

    const prom = getPrometheusMetrics();

    expect(prom).toContain('alerts_resolved_total{resolution="auto"} 1');
    expect(prom).toContain('alerts_resolved_total{resolution="stale"} 1');
  });

  it('should count evaluation errors', () => {
    recordAlert('evaluation_error');

    expect(getPrometheusMetrics()).toContain('alert_evaluation_errors_total 1');
  });

  it('should record evaluation duration as a histogram', () => {
    recordAlertEvaluationDuration(12);
    recordAlertEvaluationDuration(20);

    const prom = getPrometheusMetrics();

    expect(prom).toContain('alert_evaluation_duration_ms_count 2');
    expect(prom).toContain('alert_evaluation_duration_ms_sum 32');
  });

  it('should be reset by resetMetrics', () => {
    recordAlert('fired', { severity: 'info' });
    resetMetrics();

    expect(getPrometheusMetrics()).not.toContain('alerts_fired_total{severity="info"}');
  });
});
```

Add `recordAlert` and `recordAlertEvaluationDuration` to that file's existing import from `@/lib/monitoring/metrics`.

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/metrics.test.ts`
Expected: FAIL — `recordAlert is not a function`.

- [ ] **Step 7: Add the metrics**

In `lib/monitoring/metrics.ts`, extend the `MetricsStore` interface and the `metrics` object:

```typescript
  /** Alert counters keyed by label value */
  alertsFired: Map<string, CounterEntry>;
  alertsResolved: Map<string, CounterEntry>;
  alerts: {
    evaluationErrors: number;
    evaluationDuration: HistogramEntry;
  };
```

```typescript
  alertsFired: new Map(),
  alertsResolved: new Map(),
  alerts: {
    evaluationErrors: 0,
    evaluationDuration: { count: 0, sum: 0, min: Infinity, max: -Infinity, lastUpdated: 0 },
  },
```

Add the recording functions after `recordIngestion`:

```typescript
export type AlertSeverityLabel = 'info' | 'warning' | 'critical';

/**
 * Record an alerting lifecycle event.
 *
 * `evaluation_error` matters most: evaluation failures are swallowed by design so
 * they cannot drop readings, which makes this counter the only signal that
 * alerting has silently stopped working.
 */
export function recordAlert(
  event: 'fired' | 'resolved' | 'evaluation_error',
  labels: { severity?: AlertSeverityLabel; resolution?: string } = {}
): void {
  const now = Date.now();

  if (event === 'evaluation_error') {
    metrics.alerts.evaluationErrors++;
    return;
  }

  const target = event === 'fired' ? metrics.alertsFired : metrics.alertsResolved;
  const label = event === 'fired' ? (labels.severity ?? 'unknown') : (labels.resolution ?? 'unknown');
  const entry = target.get(label) || { value: 0, lastUpdated: 0 };
  entry.value++;
  entry.lastUpdated = now;
  target.set(label, entry);
}

/**
 * Record how long one evaluateReadings() call took.
 */
export function recordAlertEvaluationDuration(durationMs: number): void {
  const h = metrics.alerts.evaluationDuration;
  h.count++;
  h.sum += durationMs;
  h.min = Math.min(h.min, durationMs);
  h.max = Math.max(h.max, durationMs);
  h.lastUpdated = Date.now();
}
```

Extend `getPrometheusMetrics()` before the final `return lines.join('\n')`:

```typescript
  // Alerting metrics
  lines.push('# HELP alerts_fired_total Total alerts that started firing');
  lines.push('# TYPE alerts_fired_total counter');
  for (const [severity, entry] of metrics.alertsFired)
    lines.push(`alerts_fired_total{severity="${severity}"} ${entry.value}`);

  lines.push('# HELP alerts_resolved_total Total alerts resolved, by resolution kind');
  lines.push('# TYPE alerts_resolved_total counter');
  for (const [resolution, entry] of metrics.alertsResolved)
    lines.push(`alerts_resolved_total{resolution="${resolution}"} ${entry.value}`);

  lines.push('# HELP alert_evaluation_duration_ms Alert rule evaluation latency');
  lines.push('# TYPE alert_evaluation_duration_ms histogram');
  lines.push(`alert_evaluation_duration_ms_count ${metrics.alerts.evaluationDuration.count}`);
  lines.push(`alert_evaluation_duration_ms_sum ${metrics.alerts.evaluationDuration.sum}`);

  lines.push('# HELP alert_evaluation_errors_total Alert evaluations that threw');
  lines.push('# TYPE alert_evaluation_errors_total counter');
  lines.push(`alert_evaluation_errors_total ${metrics.alerts.evaluationErrors}`);
```

Extend `getMetricsSnapshot()` to include an `alerts` section (fired/resolved counts, error count, average duration), and extend `resetMetrics()`:

```typescript
  metrics.alertsFired.clear();
  metrics.alertsResolved.clear();
  metrics.alerts = {
    evaluationErrors: 0,
    evaluationDuration: { count: 0, sum: 0, min: Infinity, max: -Infinity, lastUpdated: 0 },
  };
```

In `lib/monitoring/index.ts`, add `recordAlert`, `recordAlertEvaluationDuration`, and `type AlertSeverityLabel` to the `./metrics` export block.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test __tests__/unit/lib/metrics.test.ts __tests__/unit/lib/cacheKeys.test.ts __tests__/unit/lib/cacheInvalidation.test.ts __tests__/unit/lib/indexExports.test.ts`
Expected: PASS. `indexExports.test.ts` asserts barrel completeness — if it fails, an export is missing from `lib/cache/index.ts` or `lib/monitoring/index.ts`.

- [ ] **Step 9: Commit**

```bash
git add lib/cache/keys.ts lib/cache/invalidation.ts lib/cache/index.ts lib/monitoring/metrics.ts lib/monitoring/index.ts __tests__/unit/lib/cacheKeys.test.ts __tests__/unit/lib/metrics.test.ts
git commit -m "feat(alerting): add rule cache key, invalidation, and alert metrics"
```

---

### Task 5: Selector matching and metric accessors

Pure predicates, no I/O. This is where "does this rule cover this device?" and "does this reading breach?" are decided.

**Files:**
- Create: `lib/alerting/types.ts`
- Create: `lib/alerting/selector.ts`
- Test: `__tests__/unit/lib/alerting/selector.test.ts`

**Interfaces:**
- Consumes: `IAlertRuleSelector`, `AlertMetric`, `AlertComparison` from `@/models/v2/AlertRuleV2` (Task 1); `IDeviceV2` from `@/models/v2/DeviceV2`; `IReadingV2` from `@/models/v2/ReadingV2`.
- Produces:
  - `export type EvaluableDevice = Pick<IDeviceV2, '_id' | 'type' | 'location' | 'metadata'>`
  - `export type EvaluableReading = Partial<IReadingV2>`
  - `export interface EvaluationResult { fired: FiredAlert[]; resolved: ResolvedAlert[]; pendingOpened: number; pendingCleared: number; suppressed: number; evaluatedPairs: number }`
  - `export const METRIC_ACCESSORS: Record<AlertMetric, (r: EvaluableReading) => number | undefined>`
  - `export function compare(value: number, comparison: AlertComparison, threshold: number): boolean`
  - `export function matchesSelector(device: EvaluableDevice, selector: IAlertRuleSelector): boolean`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/alerting/selector.test.ts`:

```typescript
/**
 * Alert Selector and Metric Accessor Tests
 */

import { matchesSelector, compare, METRIC_ACCESSORS } from '@/lib/alerting/selector';
import type { EvaluableDevice, EvaluableReading } from '@/lib/alerting/types';

function device(overrides: Partial<EvaluableDevice> = {}): EvaluableDevice {
  return {
    _id: 'device_001',
    type: 'temperature',
    location: { building_id: 'HQ', floor: 3, room_name: 'Lab A', zone: 'north' },
    metadata: { tags: ['critical', 'hvac'], department: 'Facilities' },
    ...overrides,
  } as EvaluableDevice;
}

describe('matchesSelector', () => {
  it('should match an empty selector against any device', () => {
    expect(matchesSelector(device(), {})).toBe(true);
  });

  it('should match on building_id', () => {
    expect(matchesSelector(device(), { building_id: 'HQ' })).toBe(true);
    expect(matchesSelector(device(), { building_id: 'Warehouse' })).toBe(false);
  });

  it('should match on floor, including floor 0', () => {
    expect(matchesSelector(device(), { floor: 3 })).toBe(true);
    expect(matchesSelector(device(), { floor: 4 })).toBe(false);
    expect(matchesSelector(device({ location: { building_id: 'HQ', floor: 0, room_name: 'Lobby' } }), { floor: 0 })).toBe(true);
  });

  it('should match on zone', () => {
    expect(matchesSelector(device(), { zone: 'north' })).toBe(true);
    expect(matchesSelector(device(), { zone: 'south' })).toBe(false);
  });

  it('should require ALL listed tags, not any', () => {
    expect(matchesSelector(device(), { tags: ['critical'] })).toBe(true);
    expect(matchesSelector(device(), { tags: ['critical', 'hvac'] })).toBe(true);
    expect(matchesSelector(device(), { tags: ['critical', 'rooftop'] })).toBe(false);
  });

  it('should treat an empty tags array as no constraint', () => {
    expect(matchesSelector(device(), { tags: [] })).toBe(true);
  });

  it('should require every present dimension simultaneously', () => {
    expect(matchesSelector(device(), { building_id: 'HQ', floor: 3, zone: 'north' })).toBe(true);
    expect(matchesSelector(device(), { building_id: 'HQ', floor: 9, zone: 'north' })).toBe(false);
  });

  it('should not match a device missing the selected dimension', () => {
    const noZone = device({ location: { building_id: 'HQ', floor: 3, room_name: 'Lab A' } } as Partial<EvaluableDevice>);
    expect(matchesSelector(noZone, { zone: 'north' })).toBe(false);
  });

  it('should tolerate a device with no metadata', () => {
    const bare = { _id: 'device_002', type: 'power', location: { building_id: 'HQ', floor: 1, room_name: 'X' } } as EvaluableDevice;
    expect(matchesSelector(bare, {})).toBe(true);
    expect(matchesSelector(bare, { tags: ['critical'] })).toBe(false);
  });

  it('should ignore selector.types — the type dimension is handled by rule bucketing', () => {
    expect(matchesSelector(device(), { types: ['power'] })).toBe(true);
  });
});

describe('compare', () => {
  it.each([
    ['gt', 31, 30, true],
    ['gt', 30, 30, false],
    ['gte', 30, 30, true],
    ['gte', 29, 30, false],
    ['lt', 29, 30, true],
    ['lt', 30, 30, false],
    ['lte', 30, 30, true],
    ['lte', 31, 30, false],
  ] as const)('%s %d vs %d -> %s', (comparison, value, threshold, expected) => {
    expect(compare(value, comparison, threshold)).toBe(expected);
  });
});

describe('METRIC_ACCESSORS', () => {
  const reading: EvaluableReading = {
    value: 35,
    quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.82 },
    context: { battery_level: 14 },
  } as EvaluableReading;

  it('should read value', () => {
    expect(METRIC_ACCESSORS.value(reading)).toBe(35);
  });

  it('should read anomaly_score', () => {
    expect(METRIC_ACCESSORS.anomaly_score(reading)).toBe(0.82);
  });

  it('should read battery_level', () => {
    expect(METRIC_ACCESSORS.battery_level(reading)).toBe(14);
  });

  it('should return undefined for an absent field rather than zero', () => {
    const bare: EvaluableReading = { value: 10 } as EvaluableReading;

    expect(METRIC_ACCESSORS.anomaly_score(bare)).toBeUndefined();
    expect(METRIC_ACCESSORS.battery_level(bare)).toBeUndefined();
  });

  it('should distinguish a real zero from an absent field', () => {
    const zero: EvaluableReading = { value: 0, context: { battery_level: 0 } } as EvaluableReading;

    expect(METRIC_ACCESSORS.value(zero)).toBe(0);
    expect(METRIC_ACCESSORS.battery_level(zero)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/alerting/selector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types module**

Create `lib/alerting/types.ts`:

```typescript
/**
 * Server-internal alerting types.
 *
 * Wire types that cross to the browser live in `types/v2/alert.types.ts` —
 * this file imports from models and is server-only.
 */

import type { IDeviceV2 } from '@/models/v2/DeviceV2';
import type { IReadingV2 } from '@/models/v2/ReadingV2';
import type { IAlertRuleV2 } from '@/models/v2/AlertRuleV2';
import type { FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

/**
 * The device projection evaluation needs. Callers pass the documents they have
 * already loaded, so evaluation adds no device query to either write path.
 */
export type EvaluableDevice = Pick<IDeviceV2, '_id' | 'type' | 'location' | 'metadata'>;

/** A reading as it exists just after insert — a partial document. */
export type EvaluableReading = Partial<IReadingV2>;

/**
 * A rule after a Redis JSON round trip: `_id` is a string, not an ObjectId.
 * See `lib/alerting/rule-cache.ts` for why this normalization is mandatory.
 */
export interface CachedAlertRule extends Omit<IAlertRuleV2, '_id'> {
  _id: string;
}

export interface EvaluationResult {
  /** Episodes that started firing in this evaluation. */
  fired: FiredAlert[];
  /** Episodes that auto-resolved in this evaluation. */
  resolved: ResolvedAlert[];
  /** Pending episodes opened (breach seen, duration not yet elapsed). */
  pendingOpened: number;
  /** Pending episodes deleted because the condition cleared first. */
  pendingCleared: number;
  /** New episodes suppressed by a rule's cooldown. */
  suppressed: number;
  /** Number of (rule, device) pairs considered. */
  evaluatedPairs: number;
}

export function emptyEvaluationResult(): EvaluationResult {
  return {
    fired: [],
    resolved: [],
    pendingOpened: 0,
    pendingCleared: 0,
    suppressed: 0,
    evaluatedPairs: 0,
  };
}
```

- [ ] **Step 4: Write the selector module**

Create `lib/alerting/selector.ts`:

```typescript
/**
 * Pure alerting predicates. No I/O, no database, no cache.
 *
 * NOTE ON THE TYPE DIMENSION: `matchesSelector` deliberately ignores
 * `selector.types`. The type dimension is handled by rule *bucketing* in
 * `rule-cache.ts`, which indexes rules by the reading type they apply to and
 * appends type-less rules to every bucket. Checking it here as well would mean
 * two places could disagree about a reading whose `metadata.type` differs from
 * its device's `type`.
 */

import type { AlertComparison, AlertMetric, IAlertRuleSelector } from '@/models/v2/AlertRuleV2';
import type { EvaluableDevice, EvaluableReading } from './types';

/**
 * Each metric is a direct field read off the reading being evaluated — no
 * derived quantities, no lookback windows. Adding a fourth is one line.
 *
 * Returns `undefined` (never 0) when the field is absent, so a reading missing
 * the metric is skipped rather than treated as a breach of a `lt` rule.
 */
export const METRIC_ACCESSORS: Record<AlertMetric, (r: EvaluableReading) => number | undefined> = {
  value: r => r.value,
  anomaly_score: r => r.quality?.anomaly_score,
  battery_level: r => r.context?.battery_level,
};

export function compare(
  value: number,
  comparison: AlertComparison,
  threshold: number
): boolean {
  switch (comparison) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    default:
      return false;
  }
}

/**
 * Does this device fall inside the rule's selector?
 *
 * A device must satisfy EVERY present dimension, and for `tags` must carry ALL
 * listed tags (not any). An absent dimension is no constraint.
 */
export function matchesSelector(
  device: EvaluableDevice,
  selector: IAlertRuleSelector | undefined
): boolean {
  if (!selector) return true;

  if (selector.building_id !== undefined && device.location?.building_id !== selector.building_id)
    return false;

  if (selector.floor !== undefined && device.location?.floor !== selector.floor) return false;

  if (selector.zone !== undefined && device.location?.zone !== selector.zone) return false;

  if (selector.tags?.length) {
    const deviceTags = new Set(device.metadata?.tags ?? []);
    if (!selector.tags.every(tag => deviceTags.has(tag))) return false;
  }

  return true;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/alerting/selector.test.ts`
Expected: PASS, 26 assertions across 15 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/alerting/types.ts lib/alerting/selector.ts __tests__/unit/lib/alerting/selector.test.ts
git commit -m "feat(alerting): add selector matching and metric accessors"
```

---

### Task 6: Rule cache and type bucketing

**Files:**
- Create: `lib/alerting/rule-cache.ts`
- Test: `__tests__/unit/lib/alerting/rule-cache.test.ts`

**The correctness detail that makes this task non-trivial:** `getOrSet` serializes to Redis with `JSON.stringify`. On a cache hit, `rule._id` comes back as a **string**, not an `ObjectId`. On a cache miss it is an `ObjectId`. If the evaluator writes `rule_id: rule._id` directly, alert documents get inconsistent `rule_id` types depending on cache state, and the dedup index silently stops deduplicating. `loadActiveRules()` therefore normalizes `_id` to a string on both paths, and the evaluator converts back with `new Types.ObjectId(rule._id)` at write time.

**Interfaces:**
- Consumes: `AlertRuleV2`, `READING_TYPES` from Task 1; `alertRulesKey` and `getOrSet` from Task 4 / `lib/cache`; `CachedAlertRule` from Task 5.
- Produces:
  - `export const ALERT_RULE_CACHE_TTL_SECONDS = 60`
  - `export interface RuleBuckets { byType: Map<ReadingType, CachedAlertRule[]>; maxCooldownSeconds: number; ruleCount: number }`
  - `export function normalizeRule(raw: unknown): CachedAlertRule`
  - `export async function loadActiveRules(): Promise<CachedAlertRule[]>`
  - `export function buildRuleBuckets(rules: CachedAlertRule[]): RuleBuckets`
  - `export async function getRuleBuckets(): Promise<RuleBuckets>`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/alerting/rule-cache.test.ts`:

```typescript
/**
 * Alert Rule Cache and Bucketing Tests
 */

import { Types } from 'mongoose';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import {
  loadActiveRules,
  buildRuleBuckets,
  normalizeRule,
  ALERT_RULE_CACHE_TTL_SECONDS,
} from '@/lib/alerting/rule-cache';
import { createAlertRuleInput, resetCounters } from '../../../setup/factories';
import type { CachedAlertRule } from '@/lib/alerting/types';

function cachedRule(overrides: Partial<CachedAlertRule> = {}): CachedAlertRule {
  return {
    _id: String(new Types.ObjectId()),
    name: 'Rule',
    enabled: true,
    selector: { types: ['temperature'] },
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    for_duration_seconds: 0,
    severity: 'warning',
    cooldown_seconds: 300,
    audit: {
      created_at: new Date(),
      created_by: 'test',
      updated_at: new Date(),
      updated_by: 'test',
    },
    ...overrides,
  } as CachedAlertRule;
}

describe('normalizeRule', () => {
  it('should stringify an ObjectId _id', () => {
    const oid = new Types.ObjectId();
    const normalized = normalizeRule({ _id: oid, name: 'X' });

    expect(normalized._id).toBe(String(oid));
    expect(typeof normalized._id).toBe('string');
  });

  it('should leave an already-stringified _id alone (Redis round trip)', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(normalizeRule({ _id: id, name: 'X' })._id).toBe(id);
  });
});

describe('loadActiveRules', () => {
  beforeEach(() => {
    resetCounters();
  });

  it('should load only enabled, non-deleted rules', async () => {
    await AlertRuleV2.create(createAlertRuleInput({ name: 'Enabled' }));
    await AlertRuleV2.create(createAlertRuleInput({ name: 'Disabled', enabled: false }));
    const deleted = await AlertRuleV2.create(createAlertRuleInput({ name: 'Deleted' }));
    await AlertRuleV2.softDelete(String(deleted._id), 'admin');

    const rules = await loadActiveRules();

    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('Enabled');
  });

  it('should return _id as a string on the fresh path', async () => {
    await AlertRuleV2.create(createAlertRuleInput());

    const rules = await loadActiveRules();

    expect(typeof rules[0]._id).toBe('string');
  });

  it('should return an empty array when no rules exist', async () => {
    expect(await loadActiveRules()).toEqual([]);
  });

  it('should use a 60 second TTL', () => {
    expect(ALERT_RULE_CACHE_TTL_SECONDS).toBe(60);
  });
});

describe('buildRuleBuckets', () => {
  it('should bucket a typed rule into exactly its own types', () => {
    const rule = cachedRule({ selector: { types: ['temperature', 'humidity'] } });

    const { byType } = buildRuleBuckets([rule]);

    expect(byType.get('temperature')).toHaveLength(1);
    expect(byType.get('humidity')).toHaveLength(1);
    expect(byType.get('power')).toHaveLength(0);
  });

  it('should append a type-less rule to every bucket', () => {
    const fleetWide = cachedRule({ metric: 'battery_level', selector: {} });

    const { byType } = buildRuleBuckets([fleetWide]);

    expect(byType.size).toBe(15);
    for (const rules of byType.values()) expect(rules).toHaveLength(1);
  });

  it('should treat an empty types array the same as absent', () => {
    const { byType } = buildRuleBuckets([cachedRule({ selector: { types: [] } })]);

    expect(byType.get('power')).toHaveLength(1);
  });

  it('should report the longest cooldown across all rules', () => {
    const buckets = buildRuleBuckets([
      cachedRule({ cooldown_seconds: 300 }),
      cachedRule({ cooldown_seconds: 900 }),
      cachedRule({ cooldown_seconds: 0 }),
    ]);

    expect(buckets.maxCooldownSeconds).toBe(900);
  });

  it('should report zero max cooldown when no rule has one', () => {
    expect(buildRuleBuckets([cachedRule({ cooldown_seconds: 0 })]).maxCooldownSeconds).toBe(0);
  });

  it('should produce empty buckets for an empty rule set', () => {
    const { byType, ruleCount, maxCooldownSeconds } = buildRuleBuckets([]);

    expect(ruleCount).toBe(0);
    expect(maxCooldownSeconds).toBe(0);
    for (const rules of byType.values()) expect(rules).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/alerting/rule-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the rule cache**

Create `lib/alerting/rule-cache.ts`:

```typescript
/**
 * Active alert rule loading, caching, and type bucketing.
 *
 * The rule set is read on every write path and changes almost never, so it is
 * cached with a short TTL and invalidated explicitly on every rule mutation.
 */

import AlertRuleV2, { READING_TYPES } from '@/models/v2/AlertRuleV2';
import type { ReadingType } from '@/models/v2/ReadingV2';
import { getOrSet } from '@/lib/cache/cache';
import { alertRulesKey } from '@/lib/cache/keys';
import type { CachedAlertRule } from './types';

export const ALERT_RULE_CACHE_TTL_SECONDS = 60;

export interface RuleBuckets {
  /** Every one of the 15 reading types is present, possibly with an empty array. */
  byType: Map<ReadingType, CachedAlertRule[]>;
  /** The longest cooldown across all active rules — bounds the cooldown lookback. */
  maxCooldownSeconds: number;
  ruleCount: number;
}

/**
 * Force `_id` to a string.
 *
 * MANDATORY. `getOrSet` stores through JSON.stringify, so a cache HIT yields a
 * string `_id` while a cache MISS yields an ObjectId. Writing that straight into
 * `AlertV2.rule_id` would produce documents whose `rule_id` type depends on cache
 * state, and the partial unique index would silently stop deduplicating. The
 * evaluator converts back with `new Types.ObjectId(rule._id)` at write time.
 */
export function normalizeRule(raw: unknown): CachedAlertRule {
  const rule = raw as CachedAlertRule & { _id: unknown };
  return { ...rule, _id: String(rule._id) };
}

export async function loadActiveRules(): Promise<CachedAlertRule[]> {
  const rules = await getOrSet<unknown[]>(
    alertRulesKey(),
    async () =>
      AlertRuleV2.find({
        enabled: true,
        'audit.deleted_at': { $exists: false },
      }).lean(),
    { ttl: ALERT_RULE_CACHE_TTL_SECONDS }
  );

  return rules.map(normalizeRule);
}

/**
 * Group rules by the reading type they apply to.
 *
 * A type-less rule is appended to every bucket ONCE, at build time, so matching
 * at evaluation stays O(readings x rules-for-that-type) rather than
 * O(readings x all-rules).
 */
export function buildRuleBuckets(rules: CachedAlertRule[]): RuleBuckets {
  const byType = new Map<ReadingType, CachedAlertRule[]>();
  for (const type of READING_TYPES) byType.set(type as ReadingType, []);

  let maxCooldownSeconds = 0;

  for (const rule of rules) {
    const targets = rule.selector?.types?.length
      ? rule.selector.types
      : (READING_TYPES as unknown as ReadingType[]);

    for (const type of targets) byType.get(type as ReadingType)?.push(rule);

    maxCooldownSeconds = Math.max(maxCooldownSeconds, rule.cooldown_seconds ?? 0);
  }

  return { byType, maxCooldownSeconds, ruleCount: rules.length };
}

export async function getRuleBuckets(): Promise<RuleBuckets> {
  return buildRuleBuckets(await loadActiveRules());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/alerting/rule-cache.test.ts`
Expected: PASS, 12 tests. Redis is not configured in the Jest environment, so `getOrSet` falls straight through to the fetch function — the tests exercise the fresh path, and `normalizeRule` is tested directly for the cache-hit shape.

- [ ] **Step 5: Commit**

```bash
git add lib/alerting/rule-cache.ts __tests__/unit/lib/alerting/rule-cache.test.ts
git commit -m "feat(alerting): add cached rule loading with type bucketing"
```

---

### Task 7: The evaluator

The core of #97. Reduces a batch to one decision per (rule, device) pair, loads the open and recently-resolved episodes for those pairs, decides everything in memory, and writes once.

**Files:**
- Create: `lib/alerting/evaluate.ts`
- Test: `__tests__/unit/lib/alerting/evaluate.test.ts`

**Interfaces:**
- Consumes: `matchesSelector`, `compare`, `METRIC_ACCESSORS` (Task 5); `getRuleBuckets` (Task 6); `AlertV2` (Task 2); `recordAlert`, `recordAlertEvaluationDuration` (Task 4).
- Produces:
  - `export async function evaluateReadings(readings: EvaluableReading[], devices: EvaluableDevice[]): Promise<EvaluationResult>`
  - `export function extractWriteErrors(err: unknown): Array<{ index: number; code: number }>`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/alerting/evaluate.test.ts`:

```typescript
/**
 * Alert Evaluation Tests
 */

import { Types } from 'mongoose';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import AlertV2 from '@/models/v2/AlertV2';
import { evaluateReadings, extractWriteErrors } from '@/lib/alerting/evaluate';
import { createAlertRuleInput, resetCounters } from '../../../setup/factories';
import type { EvaluableDevice, EvaluableReading } from '@/lib/alerting/types';

const DEVICE: EvaluableDevice = {
  _id: 'device_001',
  type: 'temperature',
  location: { building_id: 'HQ', floor: 3, room_name: 'Lab A', zone: 'north' },
  metadata: { tags: ['critical'], department: 'Facilities' },
} as EvaluableDevice;

function reading(value: number, at: Date, overrides: Partial<EvaluableReading> = {}): EvaluableReading {
  return {
    metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' },
    timestamp: at,
    value,
    quality: { is_valid: true, is_anomaly: false, anomaly_score: 0 },
    ...overrides,
  } as EvaluableReading;
}

async function seedRule(overrides = {}) {
  return AlertRuleV2.create(
    createAlertRuleInput({
      name: 'High temp',
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      severity: 'critical',
      selector: { types: ['temperature'] },
      cooldown_seconds: 0,
      ...overrides,
    })
  );
}

describe('extractWriteErrors', () => {
  it('should normalize an array of write errors', () => {
    const err = { writeErrors: [{ index: 0, code: 11000 }, { index: 2, code: 121 }] };
    expect(extractWriteErrors(err)).toEqual([{ index: 0, code: 11000 }, { index: 2, code: 121 }]);
  });

  it('should normalize a single non-array write error', () => {
    const err = { writeErrors: { index: 1, code: 11000 } };
    expect(extractWriteErrors(err)).toEqual([{ index: 1, code: 11000 }]);
  });

  it('should return an empty array for an unrelated error', () => {
    expect(extractWriteErrors(new Error('boom'))).toEqual([]);
  });
});

describe('evaluateReadings', () => {
  beforeEach(() => {
    resetCounters();
  });

  it('should return an empty result for empty inputs', async () => {
    const result = await evaluateReadings([], []);

    expect(result.fired).toEqual([]);
    expect(result.evaluatedPairs).toBe(0);
  });

  it('should open a firing alert immediately when for_duration_seconds is 0', async () => {
    const rule = await seedRule();

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].trigger_value).toBe(35);
    expect(result.fired[0].rule_name).toBe('High temp');

    const stored = await AlertV2.findOne({ device_id: 'device_001' }).lean();
    expect(stored!.status).toBe('firing');
    expect(stored!.is_open).toBe(true);
    expect(String(stored!.rule_id)).toBe(String(rule._id));
    expect(stored!.fired_at).toBeInstanceOf(Date);
  });

  it('should not fire when the reading is within bounds', async () => {
    await seedRule();

    const result = await evaluateReadings([reading(20, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(await AlertV2.countDocuments({})).toBe(0);
  });

  it('should open a pending alert when for_duration_seconds is set', async () => {
    await seedRule({ for_duration_seconds: 300 });

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(result.pendingOpened).toBe(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('pending');
    expect(stored!.fired_at).toBeUndefined();
  });

  it('should promote pending to firing once the duration elapses', async () => {
    await seedRule({ for_duration_seconds: 60 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:02:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const result = await evaluateReadings([reading(36, t1)], [DEVICE]);

    expect(result.fired).toHaveLength(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('firing');
    expect(stored!.last_value).toBe(36);
    expect(new Date(stored!.breached_since).toISOString()).toBe(t0.toISOString());
  });

  it('should delete a pending alert when the condition clears first', async () => {
    await seedRule({ for_duration_seconds: 600 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const result = await evaluateReadings([reading(20, t1)], [DEVICE]);

    expect(result.pendingCleared).toBe(1);
    expect(await AlertV2.countDocuments({})).toBe(0);
  });

  it('should auto-resolve a firing alert when the condition clears', async () => {
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:05:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    const result = await evaluateReadings([reading(20, t1)], [DEVICE]);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('auto');
    expect(result.resolved[0].actor).toBe('system');

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('resolved');
    expect(stored!.is_open).toBe(false);
    expect(stored!.resolved_value).toBe(20);
  });

  it('should not open a second episode while one is already open', async () => {
    await seedRule();

    await evaluateReadings([reading(35, new Date('2026-08-01T12:00:00.000Z'))], [DEVICE]);
    const result = await evaluateReadings([reading(40, new Date('2026-08-01T12:01:00.000Z'))], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(await AlertV2.countDocuments({})).toBe(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.last_value).toBe(40);
    expect(stored!.trigger_value).toBe(35);
  });

  it('should reduce by breach, not by recency', async () => {
    // breach -> clear -> breach inside ONE batch yields ONE episode whose
    // breached_since is the EARLIEST breaching reading.
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z');
    const t2 = new Date('2026-08-01T12:02:00.000Z');

    const result = await evaluateReadings(
      [reading(35, t0), reading(20, t1), reading(33, t2)],
      [DEVICE]
    );

    expect(result.fired).toHaveLength(1);
    expect(await AlertV2.countDocuments({})).toBe(1);

    const stored = await AlertV2.findOne({}).lean();
    expect(new Date(stored!.breached_since).toISOString()).toBe(t0.toISOString());
    expect(stored!.trigger_value).toBe(35);
    expect(stored!.last_value).toBe(33);
    expect(new Date(stored!.last_observed_at).toISOString()).toBe(t2.toISOString());
  });

  it('should take last_value from the latest reading even when it does not breach', async () => {
    await seedRule();
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:05:00.000Z');

    await evaluateReadings([reading(35, t0), reading(28, t1)], [DEVICE]);

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.last_value).toBe(28);
    expect(stored!.trigger_value).toBe(35);
  });

  it('should not rewind last_observed_at for an out-of-order batch', async () => {
    await seedRule();
    const late = new Date('2026-08-01T12:10:00.000Z');
    const early = new Date('2026-08-01T12:00:00.000Z');

    await evaluateReadings([reading(35, late)], [DEVICE]);
    await evaluateReadings([reading(99, early)], [DEVICE]);

    const stored = await AlertV2.findOne({}).lean();
    expect(new Date(stored!.last_observed_at).toISOString()).toBe(late.toISOString());
    expect(stored!.last_value).toBe(35);
  });

  it('should suppress a new episode inside the cooldown window', async () => {
    await seedRule({ cooldown_seconds: 3600 });
    const t0 = new Date('2026-08-01T12:00:00.000Z');
    const t1 = new Date('2026-08-01T12:01:00.000Z');
    const t2 = new Date('2026-08-01T12:02:00.000Z');

    await evaluateReadings([reading(35, t0)], [DEVICE]);
    await evaluateReadings([reading(20, t1)], [DEVICE]); // auto-resolves
    const result = await evaluateReadings([reading(35, t2)], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(result.suppressed).toBe(1);
    expect(await AlertV2.countDocuments({ is_open: true })).toBe(0);
  });

  it('should skip readings whose metric field is absent', async () => {
    await seedRule({ metric: 'battery_level', comparison: 'lt', threshold: 20, selector: {} });

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0);
    expect(result.evaluatedPairs).toBe(0);
  });

  it('should fire on anomaly_score', async () => {
    await seedRule({ metric: 'anomaly_score', comparison: 'gte', threshold: 0.8, selector: {} });

    const result = await evaluateReadings(
      [reading(22, new Date(), { quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.9 } } as Partial<EvaluableReading>)],
      [DEVICE]
    );

    expect(result.fired).toHaveLength(1);
  });

  it('should skip a reading whose device was not supplied', async () => {
    await seedRule();

    const orphan = reading(35, new Date());
    (orphan.metadata as { device_id: string }).device_id = 'device_999';

    const result = await evaluateReadings([orphan], [DEVICE]);

    expect(result.evaluatedPairs).toBe(0);
  });

  it('should not match a device outside the selector', async () => {
    await seedRule({ selector: { types: ['temperature'], building_id: 'Warehouse' } });

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0);
  });

  it('should rethrow a non-11000 bulk write error', async () => {
    await seedRule();
    const spy = jest.spyOn(AlertV2, 'bulkWrite').mockRejectedValueOnce(
      Object.assign(new Error('validation failed'), {
        writeErrors: [{ index: 0, code: 121 }],
      })
    );

    await expect(evaluateReadings([reading(35, new Date())], [DEVICE])).rejects.toThrow(
      'validation failed'
    );

    spy.mockRestore();
  });

  it('should absorb an 11000 duplicate and drop its notification', async () => {
    await seedRule();
    const spy = jest.spyOn(AlertV2, 'bulkWrite').mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key'), {
        writeErrors: [{ index: 0, code: 11000 }],
      })
    );

    const result = await evaluateReadings([reading(35, new Date())], [DEVICE]);

    expect(result.fired).toHaveLength(0); // the other request won the race

    spy.mockRestore();
  });

  it('should handle a fleet-wide rule across many devices in one write', async () => {
    await seedRule({ selector: { types: ['temperature'] } });
    const devices = Array.from({ length: 20 }, (_, i) => ({
      ...DEVICE,
      _id: `device_${String(i).padStart(3, '0')}`,
    })) as EvaluableDevice[];
    const now = new Date();
    const readings = devices.map(d => {
      const r = reading(35, now);
      (r.metadata as { device_id: string }).device_id = String(d._id);
      return r;
    });

    const bulkSpy = jest.spyOn(AlertV2, 'bulkWrite');
    const result = await evaluateReadings(readings, devices);

    expect(result.fired).toHaveLength(20);
    expect(bulkSpy).toHaveBeenCalledTimes(1);

    bulkSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/alerting/evaluate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the evaluator**

Create `lib/alerting/evaluate.ts`:

```typescript
/**
 * Alert rule evaluation.
 *
 * Called by both write paths AFTER their insert has committed, so it can never
 * roll back an insert. Owns no scheduler, no queue, and no second state store.
 *
 * COST: two queries, one bulk write, constant in batch size (plus a third query
 * on a rule-cache miss). Whether the request carried 1 reading or 10,000, the
 * number of round trips is identical. That is a structural property of the
 * reduction below, not a benchmark.
 *
 * It is NOT constant in fleet size: work is linear in candidate (rule, device)
 * pairs, which is the $in cardinality and the bulk operation count.
 */

import { Types, type AnyBulkWriteOperation } from 'mongoose';
import AlertV2, { type IAlertV2 } from '@/models/v2/AlertV2';
import { recordAlert, recordAlertEvaluationDuration } from '@/lib/monitoring';
import { getRuleBuckets } from './rule-cache';
import { METRIC_ACCESSORS, compare, matchesSelector } from './selector';
import {
  emptyEvaluationResult,
  type CachedAlertRule,
  type EvaluableDevice,
  type EvaluableReading,
  type EvaluationResult,
} from './types';
import type { FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

const DUPLICATE_KEY_CODE = 11000;

/** One (rule, device) pair's reduced state for this batch. */
interface PairState {
  rule: CachedAlertRule;
  device: EvaluableDevice;
  breaching: boolean;
  /** Metric value of the EARLIEST breaching reading. */
  triggerValue?: number;
  /** Timestamp of the EARLIEST breaching reading. */
  breachedSince?: Date;
  /** Metric value of the LATEST reading overall, breaching or not. */
  lastValue: number;
  /** Timestamp of the LATEST reading overall. */
  lastObservedAt: Date;
}

/** A notification queued against a bulk-write op index, dropped if that op failed. */
type PendingNotification =
  | { kind: 'fired'; alert: FiredAlert }
  | { kind: 'resolved'; alert: ResolvedAlert }
  | null;

/**
 * Normalize the driver's write errors.
 *
 * MongoBulkWriteError.writeErrors is typed OneOrMore<WriteError> — a single
 * failure can arrive as a bare object rather than an array.
 */
export function extractWriteErrors(err: unknown): Array<{ index: number; code: number }> {
  const raw = (err as { writeErrors?: unknown })?.writeErrors;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(e => ({
    index: Number((e as { index?: number }).index ?? -1),
    code: Number((e as { code?: number }).code ?? 0),
  }));
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function toFiredAlert(
  id: Types.ObjectId,
  rule: CachedAlertRule,
  device: EvaluableDevice,
  state: PairState,
  firedAt: Date
): FiredAlert {
  return {
    _id: String(id),
    rule_id: rule._id,
    rule_name: rule.name,
    device_id: String(device._id),
    severity: rule.severity,
    metric: rule.metric,
    comparison: rule.comparison,
    threshold: rule.threshold,
    trigger_value: state.triggerValue ?? state.lastValue,
    fired_at: firedAt.toISOString(),
  };
}

export async function evaluateReadings(
  readings: EvaluableReading[],
  devices: EvaluableDevice[]
): Promise<EvaluationResult> {
  const started = Date.now();

  if (readings.length === 0 || devices.length === 0) return emptyEvaluationResult();

  const deviceById = new Map(devices.map(d => [String(d._id), d]));
  const { byType } = await getRuleBuckets();

  // ---- Steps 1-3: match and reduce to one decision per (rule, device) pair ----
  //
  // The reduction is BREACH-AWARE, not newest-wins. Alerting evaluates the
  // aggregate state of each device per request; it is not a backfill engine and
  // does not replay a batch as a timeline.
  const pairs = new Map<string, PairState>();
  let maxCooldownSeconds = 0;

  for (const reading of readings) {
    const deviceId = reading.metadata?.device_id;
    const type = reading.metadata?.type;
    if (!deviceId || !type) continue;

    const device = deviceById.get(deviceId);
    if (!device) continue;

    const ts = toDate(reading.timestamp ?? new Date());
    const rules = byType.get(type) ?? [];

    for (const rule of rules) {
      if (!matchesSelector(device, rule.selector)) continue;

      const metricValue = METRIC_ACCESSORS[rule.metric](reading);
      if (metricValue === undefined || metricValue === null || Number.isNaN(metricValue)) continue;

      maxCooldownSeconds = Math.max(maxCooldownSeconds, rule.cooldown_seconds ?? 0);

      const key = `${rule._id}::${deviceId}`;
      const breaches = compare(metricValue, rule.comparison, rule.threshold);
      const existing = pairs.get(key);

      if (!existing) {
        pairs.set(key, {
          rule,
          device,
          breaching: breaches,
          triggerValue: breaches ? metricValue : undefined,
          breachedSince: breaches ? ts : undefined,
          lastValue: metricValue,
          lastObservedAt: ts,
        });
        continue;
      }

      if (breaches) {
        existing.breaching = true;
        if (!existing.breachedSince || ts < existing.breachedSince) {
          existing.breachedSince = ts;
          existing.triggerValue = metricValue;
        }
      }

      if (ts >= existing.lastObservedAt) {
        existing.lastValue = metricValue;
        existing.lastObservedAt = ts;
      }
    }
  }

  if (pairs.size === 0) {
    recordAlertEvaluationDuration(Date.now() - started);
    return emptyEvaluationResult();
  }

  // ---- Steps 4-5: two queries ----
  const ruleObjectIds = [...new Set([...pairs.values()].map(p => p.rule._id))].map(
    id => new Types.ObjectId(id)
  );
  const deviceIds = [...new Set([...pairs.values()].map(p => String(p.device._id)))];

  const openEpisodes = await AlertV2.find({
    is_open: true,
    rule_id: { $in: ruleObjectIds },
    device_id: { $in: deviceIds },
  }).lean<IAlertV2[]>();

  const cooldownSince = new Date(Date.now() - maxCooldownSeconds * 1000);
  const recentlyResolved =
    maxCooldownSeconds > 0
      ? await AlertV2.find({
          rule_id: { $in: ruleObjectIds },
          device_id: { $in: deviceIds },
          'audit.resolved_at': { $gte: cooldownSince },
        })
          .select({ rule_id: 1, device_id: 1, 'audit.resolved_at': 1 })
          .lean<IAlertV2[]>()
      : [];

  const openByPair = new Map(openEpisodes.map(a => [`${a.rule_id}::${a.device_id}`, a]));

  const lastResolvedByPair = new Map<string, Date>();
  for (const episode of recentlyResolved) {
    const at = episode.audit?.resolved_at;
    if (!at) continue;
    const key = `${episode.rule_id}::${episode.device_id}`;
    const prev = lastResolvedByPair.get(key);
    if (!prev || toDate(at) > prev) lastResolvedByPair.set(key, toDate(at));
  }

  // ---- Step 6: decide every pair in memory ----
  const now = new Date();
  const ops: AnyBulkWriteOperation<IAlertV2>[] = [];
  const notifications: PendingNotification[] = [];
  let pendingOpened = 0;
  let pendingCleared = 0;
  let suppressed = 0;

  const push = (op: AnyBulkWriteOperation<IAlertV2>, notification: PendingNotification = null) => {
    ops.push(op);
    notifications.push(notification);
  };

  for (const [key, state] of pairs) {
    const existing = openByPair.get(key);
    const { rule, device } = state;

    // An out-of-order batch must never rewind state into the sweep's path.
    if (existing && state.lastObservedAt <= toDate(existing.last_observed_at)) continue;

    if (state.breaching) {
      if (!existing) {
        const lastResolved = lastResolvedByPair.get(key);
        if (
          lastResolved &&
          (rule.cooldown_seconds ?? 0) > 0 &&
          now.getTime() - lastResolved.getTime() < rule.cooldown_seconds * 1000
        ) {
          suppressed++;
          continue;
        }

        const firesImmediately = (rule.for_duration_seconds ?? 0) === 0;
        const _id = new Types.ObjectId();

        push(
          {
            insertOne: {
              document: {
                _id,
                rule_id: new Types.ObjectId(rule._id),
                rule_name: rule.name,
                device_id: String(device._id),
                status: firesImmediately ? 'firing' : 'pending',
                is_open: true,
                severity: rule.severity,
                metric: rule.metric,
                comparison: rule.comparison,
                threshold: rule.threshold,
                trigger_value: state.triggerValue as number,
                last_value: state.lastValue,
                breached_since: state.breachedSince as Date,
                last_observed_at: state.lastObservedAt,
                ...(firesImmediately ? { fired_at: now } : {}),
                audit: {
                  created_at: now,
                  created_by: 'system',
                  updated_at: now,
                  updated_by: 'system',
                },
              } as unknown as IAlertV2,
            },
          },
          firesImmediately ? { kind: 'fired', alert: toFiredAlert(_id, rule, device, state, now) } : null
        );

        if (firesImmediately) recordAlert('fired', { severity: rule.severity });
        else pendingOpened++;
        continue;
      }

      if (existing.status === 'pending') {
        const elapsedMs = state.lastObservedAt.getTime() - toDate(existing.breached_since).getTime();

        if (elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000) {
          push(
            {
              updateOne: {
                filter: {
                  _id: existing._id,
                  status: 'pending',
                  last_observed_at: { $lt: state.lastObservedAt },
                },
                update: {
                  $set: {
                    status: 'firing',
                    fired_at: now,
                    last_value: state.lastValue,
                    'audit.updated_at': now,
                    'audit.updated_by': 'system',
                  },
                  $max: { last_observed_at: state.lastObservedAt },
                },
              },
            },
            { kind: 'fired', alert: toFiredAlert(existing._id, rule, device, state, now) }
          );
          recordAlert('fired', { severity: rule.severity });
        } else {
          push({
            updateOne: {
              filter: { _id: existing._id, last_observed_at: { $lt: state.lastObservedAt } },
              update: {
                $set: { last_value: state.lastValue, 'audit.updated_at': now },
                $max: { last_observed_at: state.lastObservedAt },
              },
            },
          });
        }
        continue;
      }

      // firing or acknowledged: refresh the observation, do not re-fire.
      push({
        updateOne: {
          filter: { _id: existing._id, last_observed_at: { $lt: state.lastObservedAt } },
          update: {
            $set: { last_value: state.lastValue, 'audit.updated_at': now },
            $max: { last_observed_at: state.lastObservedAt },
          },
        },
      });
      continue;
    }

    // ---- not breaching ----
    if (!existing) continue;

    if (existing.status === 'pending') {
      // An episode that never fired is not history, and keeping them would let a
      // flapping sensor fill the collection.
      push({ deleteOne: { filter: { _id: existing._id, status: 'pending' } } });
      pendingCleared++;
      continue;
    }

    push(
      {
        updateOne: {
          filter: {
            _id: existing._id,
            is_open: true,
            last_observed_at: { $lt: state.lastObservedAt },
          },
          update: {
            $set: {
              status: 'resolved',
              is_open: false,
              last_value: state.lastValue,
              resolved_value: state.lastValue,
              'audit.updated_at': now,
              'audit.updated_by': 'system',
              'audit.resolved_at': now,
              'audit.resolved_by': 'system',
              'audit.resolution': 'auto',
            },
            $max: { last_observed_at: state.lastObservedAt },
          },
        },
      },
      {
        kind: 'resolved',
        alert: {
          _id: String(existing._id),
          rule_id: String(existing.rule_id),
          device_id: existing.device_id,
          severity: existing.severity,
          resolution: 'auto',
          resolved_at: now.toISOString(),
          actor: 'system',
        },
      }
    );
    recordAlert('resolved', { resolution: 'auto' });
  }

  // ---- Step 7: one bulk write ----
  const failedIndices = new Set<number>();

  if (ops.length > 0)
    try {
      await AlertV2.bulkWrite(ops, { ordered: false });
    } catch (err) {
      const writeErrors = extractWriteErrors(err);
      const unexpected = writeErrors.filter(e => e.code !== DUPLICATE_KEY_CODE);

      // Only E11000 is absorbed. Without this filter a genuine write failure
      // would vanish into the same silent path as a benign race, and
      // alert_evaluation_errors_total would stop being a trustworthy signal.
      if (unexpected.length > 0 || writeErrors.length === 0) throw err;

      // Every error was a duplicate open episode: another request won the race,
      // which is the desired end state either way.
      for (const e of writeErrors) failedIndices.add(e.index);
    }

  const result = emptyEvaluationResult();
  result.pendingOpened = pendingOpened;
  result.pendingCleared = pendingCleared;
  result.suppressed = suppressed;
  result.evaluatedPairs = pairs.size;

  for (let i = 0; i < notifications.length; i++) {
    const notification = notifications[i];
    if (!notification || failedIndices.has(i)) continue;
    if (notification.kind === 'fired') result.fired.push(notification.alert);
    else result.resolved.push(notification.alert);
  }

  recordAlertEvaluationDuration(Date.now() - started);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/alerting/evaluate.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/alerting/evaluate.ts __tests__/unit/lib/alerting/evaluate.test.ts
git commit -m "feat(alerting): add breach-aware rule evaluator with index-enforced dedup"
```

---

### Task 8: Staleness sweep and the failure-isolating public surface

Closes the "device stops reporting, alert fires forever" gap, and wraps both entry points so no caller can forget the try/catch that keeps evaluation from dropping readings.

**Files:**
- Create: `lib/alerting/sweep.ts`
- Create: `lib/alerting/index.ts`
- Test: `__tests__/unit/lib/alerting/sweep.test.ts`

**Design note:** the sweep takes the reporting device id set as an argument rather than querying for it. The cron route has already loaded its active devices, so this keeps the sweep at **one query plus one bulk write**, and makes "device is no longer active" mean exactly "the cron no longer emits readings for it" — which is precisely the condition that leaves an alert stranded.

**Interfaces:**
- Consumes: `AlertV2` (Task 2), `evaluateReadings` (Task 7), `recordAlert` (Task 4), `logger` from `@/lib/monitoring`.
- Produces:
  - `export const STALE_AFTER_SECONDS: number` (env `ALERT_STALE_AFTER_SECONDS`, default 1800)
  - `export async function sweepStaleAlerts(reportingDeviceIds: Set<string>): Promise<SweepResult>` where `SweepResult = { deleted: number; resolved: ResolvedAlert[] }`
  - `export async function safeEvaluateReadings(readings, devices): Promise<EvaluationResult>` — never throws
  - `export async function safeSweepStaleAlerts(reportingDeviceIds): Promise<SweepResult>` — never throws

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/alerting/sweep.test.ts`:

```typescript
/**
 * Staleness Sweep Tests
 */

import AlertV2 from '@/models/v2/AlertV2';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import { logger } from '@/lib/monitoring';
import { sweepStaleAlerts, STALE_AFTER_SECONDS } from '@/lib/alerting/sweep';
import { safeEvaluateReadings, safeSweepStaleAlerts } from '@/lib/alerting';
import { createAlertInput, createAlertRuleInput, resetCounters } from '../../../setup/factories';

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

describe('STALE_AFTER_SECONDS', () => {
  it('should default to 30 minutes', () => {
    expect(STALE_AFTER_SECONDS).toBe(1800);
  });
});

describe('sweepStaleAlerts', () => {
  beforeEach(() => {
    resetCounters();
  });

  it('should do nothing when there are no open alerts', async () => {
    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.deleted).toBe(0);
    expect(result.resolved).toEqual([]);
  });

  it('should leave a fresh alert on a reporting device alone', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_001', status: 'firing', last_observed_at: minutesAgo(1) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(0);
    expect((await AlertV2.findOne({}).lean())!.status).toBe('firing');
  });

  it('should resolve a firing alert whose device stopped reporting', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_gone', status: 'firing', last_observed_at: minutesAgo(1) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('device_inactive');

    const stored = await AlertV2.findOne({}).lean();
    expect(stored!.status).toBe('resolved');
    expect(stored!.is_open).toBe(false);
    expect(stored!.audit.resolution).toBe('device_inactive');
  });

  it('should resolve a firing alert that has gone stale', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_001', status: 'firing', last_observed_at: minutesAgo(60) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('stale');
  });

  it('should resolve an acknowledged alert the same way', async () => {
    await AlertV2.create(
      createAlertInput({
        device_id: 'device_001',
        status: 'acknowledged',
        last_observed_at: minutesAgo(60),
      })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved).toHaveLength(1);
    expect((await AlertV2.findOne({}).lean())!.status).toBe('resolved');
  });

  it('should DELETE a swept pending alert rather than resolving it', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_001', status: 'pending', last_observed_at: minutesAgo(60) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.deleted).toBe(1);
    expect(result.resolved).toHaveLength(0);
    expect(await AlertV2.countDocuments({})).toBe(0);
  });

  it('should never touch an already-resolved alert', async () => {
    await AlertV2.create(
      createAlertInput({
        device_id: 'device_gone',
        status: 'resolved',
        is_open: false,
        last_observed_at: minutesAgo(600),
      })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.deleted).toBe(0);
    expect(result.resolved).toHaveLength(0);
  });

  it('should prefer device_inactive over stale when both apply', async () => {
    await AlertV2.create(
      createAlertInput({ device_id: 'device_gone', status: 'firing', last_observed_at: minutesAgo(600) })
    );

    const result = await sweepStaleAlerts(new Set(['device_001']));

    expect(result.resolved[0].resolution).toBe('device_inactive');
  });
});

describe('safe wrappers', () => {
  it('should swallow an evaluation error and return an empty result', async () => {
    // A matching rule is MANDATORY here. Without one, no (rule, device) pair is
    // formed, evaluateReadings short-circuits on `pairs.size === 0` BEFORE it
    // ever calls AlertV2.find, and the mocked throw is never reached — the
    // assertion would then pass whether or not the try/catch does anything.
    await AlertRuleV2.create(
      createAlertRuleInput({
        metric: 'value',
        comparison: 'gt',
        threshold: 0,
        selector: { types: ['temperature'] },
      })
    );

    const spy = jest.spyOn(AlertV2, 'find').mockImplementationOnce(() => {
      throw new Error('database exploded');
    });
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    const result = await safeEvaluateReadings(
      [{ metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius', source: 'sensor' }, timestamp: new Date(), value: 1 }] as never,
      [{ _id: 'device_001', type: 'temperature', location: { building_id: 'HQ', floor: 1, room_name: 'X' }, metadata: { tags: [], department: 'x' } }] as never
    );

    expect(result.fired).toEqual([]);
    // Proves the catch block actually executed, rather than the happy path
    // returning an empty result for unrelated reasons.
    expect(spy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    spy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should swallow a sweep error', async () => {
    const spy = jest.spyOn(AlertV2, 'find').mockImplementationOnce(() => {
      throw new Error('database exploded');
    });

    const result = await safeSweepStaleAlerts(new Set(['device_001']));

    expect(result).toEqual({ deleted: 0, resolved: [] });
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/alerting/sweep.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the sweep**

Create `lib/alerting/sweep.ts`:

```typescript
/**
 * Staleness sweep.
 *
 * An episode auto-resolves when a NEW reading shows the metric back within
 * bounds, so a device that stops reporting would otherwise stay firing forever.
 * The simulate cron emits a reading for every active device on every run, so the
 * real gap is a device that leaves the active set: decommissioned, soft-deleted,
 * or silent because it broke.
 *
 * Runs on the cron path only — one query per cron invocation, not per ingest.
 * The caller passes the device ids it just emitted readings for, so this stays at
 * one query plus one bulk write and needs no device lookup of its own.
 */

import { type AnyBulkWriteOperation, type Types } from 'mongoose';
import AlertV2, { type IAlertV2 } from '@/models/v2/AlertV2';
import { recordAlert } from '@/lib/monitoring';
import type { ResolvedAlert } from '@/types/v2/alert.types';

export const STALE_AFTER_SECONDS = parseInt(
  process.env.ALERT_STALE_AFTER_SECONDS || '1800',
  10
);

export interface SweepResult {
  /** Pending episodes deleted — an episode that never fired is not history. */
  deleted: number;
  /** Firing/acknowledged episodes resolved — they did fire, so the history is real. */
  resolved: ResolvedAlert[];
}

export async function sweepStaleAlerts(reportingDeviceIds: Set<string>): Promise<SweepResult> {
  const openAlerts = await AlertV2.find({ is_open: true }).lean<IAlertV2[]>();
  if (openAlerts.length === 0) return { deleted: 0, resolved: [] };

  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_AFTER_SECONDS * 1000);

  const toDelete: Types.ObjectId[] = [];
  const ops: AnyBulkWriteOperation<IAlertV2>[] = [];
  const resolved: ResolvedAlert[] = [];

  for (const alert of openAlerts) {
    const deviceInactive = !reportingDeviceIds.has(alert.device_id);
    const observationStale = new Date(alert.last_observed_at) < cutoff;
    if (!deviceInactive && !observationStale) continue;

    if (alert.status === 'pending') {
      toDelete.push(alert._id);
      continue;
    }

    // Recorded distinctly from 'auto' so history never claims a problem was fixed
    // when the sensor merely went quiet.
    const resolution = deviceInactive ? 'device_inactive' : 'stale';

    ops.push({
      updateOne: {
        filter: { _id: alert._id, is_open: true },
        update: {
          $set: {
            status: 'resolved',
            is_open: false,
            'audit.updated_at': now,
            'audit.updated_by': 'system',
            'audit.resolved_at': now,
            'audit.resolved_by': 'system',
            'audit.resolution': resolution,
          },
        },
      },
    });

    resolved.push({
      _id: String(alert._id),
      rule_id: String(alert.rule_id),
      device_id: alert.device_id,
      severity: alert.severity,
      resolution,
      resolved_at: now.toISOString(),
      actor: 'system',
    });

    recordAlert('resolved', { resolution });
  }

  // The `status: 'pending'` guard is NOT optional. Between this function's
  // snapshot read and its bulk write, a concurrent evaluateReadings() on the
  // ingest path can promote one of these episodes to `firing` via its own
  // status-guarded updateOne. Deleting by _id alone would then destroy a
  // legitimately-fired alert's history instead of leaving it to resolve
  // normally. Mirrors the `is_open: true` guard on the resolve op above.
  if (toDelete.length > 0)
    ops.push({ deleteMany: { filter: { _id: { $in: toDelete }, status: 'pending' } } });

  if (ops.length > 0) await AlertV2.bulkWrite(ops, { ordered: false });

  return { deleted: toDelete.length, resolved };
}
```

- [ ] **Step 4: Write the public surface**

Create `lib/alerting/index.ts`:

```typescript
/**
 * Public alerting surface.
 *
 * Both write paths call the `safe*` wrappers, never the raw functions. Issue #97
 * requires that evaluation failures never drop readings; three properties
 * guarantee it:
 *
 *   1. Evaluation runs strictly AFTER insertMany has committed. There is no path
 *      by which it can roll back an insert.
 *   2. The call is wrapped here in its own try/catch. Errors are logged and
 *      counted; they never propagate to withErrorHandler and never change the
 *      response status.
 *   3. Route response bodies report insert results only. Alerting is not part of
 *      their contract.
 *
 * This mirrors the existing treatment of the Pusher trigger in the simulate route.
 */

import { logger, recordAlert } from '@/lib/monitoring';
import { evaluateReadings } from './evaluate';
import { sweepStaleAlerts, type SweepResult } from './sweep';
import { emptyEvaluationResult, type EvaluableDevice, type EvaluableReading, type EvaluationResult } from './types';

export { evaluateReadings } from './evaluate';
export { sweepStaleAlerts, STALE_AFTER_SECONDS, type SweepResult } from './sweep';
export { matchesSelector, compare, METRIC_ACCESSORS } from './selector';
export { getRuleBuckets, loadActiveRules, buildRuleBuckets } from './rule-cache';
export type { EvaluableDevice, EvaluableReading, EvaluationResult, CachedAlertRule } from './types';

export async function safeEvaluateReadings(
  readings: EvaluableReading[],
  devices: EvaluableDevice[]
): Promise<EvaluationResult> {
  try {
    return await evaluateReadings(readings, devices);
  } catch (error) {
    recordAlert('evaluation_error');
    logger.error('Alert evaluation failed after a committed write', {
      readingsCount: readings.length,
      deviceCount: devices.length,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return emptyEvaluationResult();
  }
}

export async function safeSweepStaleAlerts(
  reportingDeviceIds: Set<string>
): Promise<SweepResult> {
  try {
    return await sweepStaleAlerts(reportingDeviceIds);
  } catch (error) {
    recordAlert('evaluation_error');
    logger.error('Alert staleness sweep failed', {
      reportingDeviceCount: reportingDeviceIds.size,
      error: error instanceof Error ? error.message : String(error),
    });
    return { deleted: 0, resolved: [] };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test __tests__/unit/lib/alerting`
Expected: PASS — all four alerting unit suites green.

- [ ] **Step 6: Commit**

```bash
git add lib/alerting/sweep.ts lib/alerting/index.ts __tests__/unit/lib/alerting/sweep.test.ts
git commit -m "feat(alerting): add staleness sweep and failure-isolating entry points"
```

---

### Task 9: Wire evaluation into both write paths

The whole reason evaluation is specified at both paths: **every reading in the live deployment arrives via `/api/v2/cron/simulate` and never touches `/api/v2/readings/ingest`.** Wiring only the ingest path would ship code that never executes in the deployed demo.

**Files:**
- Modify: `app/api/v2/readings/ingest/route.ts`
- Modify: `app/api/v2/cron/simulate/route.ts`
- Test: `__tests__/integration/api/readings-ingest.integration.test.ts` (extend)
- Test: `__tests__/integration/api/simulate-cron.integration.test.ts` (extend)

**Both device projections must change.** The ingest route currently projects the id alone, because its only use for the query is an existence check — it needs the selector-relevant fields *added*, not merely widened by one:

| Path | Current projection | Required |
| --- | --- | --- |
| `app/api/v2/readings/ingest/route.ts:144-147` | `{ _id: 1 }` | `{ _id: 1, type: 1, location: 1, 'metadata.tags': 1 }` |
| `app/api/v2/cron/simulate/route.ts:43` | `{ _id: 1, type: 1, location: 1 }` | add `'metadata.tags': 1` |

**Interfaces:**
- Consumes: `safeEvaluateReadings`, `safeSweepStaleAlerts` from `@/lib/alerting` (Task 8).
- Produces: no new exports. Both routes' response bodies are unchanged.

- [ ] **Step 1: Write the failing integration tests**

Append to `__tests__/integration/api/readings-ingest.integration.test.ts`:

```typescript
describe('alert evaluation on the ingest path', () => {
  it('should open a firing alert for a breaching ingested reading', async () => {
    await seedDevice('device_alert_01'); // reuse the file's existing helper
    await AlertRuleV2.create(
      createAlertRuleInput({
        name: 'Ingest high temp',
        metric: 'value',
        comparison: 'gt',
        threshold: 30,
        severity: 'critical',
        selector: { types: ['temperature'] },
      })
    );

    const request = createMockPostRequest('/api/v2/readings/ingest', {
      readings: [
        { device_id: 'device_alert_01', type: 'temperature', unit: 'celsius', value: 42, timestamp: new Date().toISOString() },
      ],
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const alert = await AlertV2.findOne({ device_id: 'device_alert_01' }).lean();
    expect(alert).not.toBeNull();
    expect(alert!.status).toBe('firing');
  });

  it('should still return 201 with readings persisted when evaluation throws', async () => {
    await seedDevice('device_alert_02');
    // Spy on the SOURCE module, not the barrel. `safeEvaluateReadings` calls
    // `evaluateReadings` through a direct import binding, so spying on the
    // re-export in `@/lib/alerting` does not intercept it and the test would
    // pass vacuously.
    const spy = jest
      .spyOn(evaluateModule, 'evaluateReadings')
      .mockRejectedValueOnce(new Error('evaluator exploded'));

    const request = createMockPostRequest('/api/v2/readings/ingest', {
      readings: [
        { device_id: 'device_alert_02', type: 'temperature', unit: 'celsius', value: 42, timestamp: new Date().toISOString() },
      ],
    });

    const response = await POST(request);
    const body = await parseResponse<{ success: boolean; data: { inserted: number } }>(response);

    expect(response.status).toBe(201);
    expect(body.data.inserted).toBe(1);
    expect(await ReadingV2.countDocuments({ 'metadata.device_id': 'device_alert_02' })).toBe(1);
    // Without this the test cannot distinguish "error was swallowed" from
    // "the evaluator was never reached at all".
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});
```

Add these imports to that file: `import AlertRuleV2 from '@/models/v2/AlertRuleV2';`, `import AlertV2 from '@/models/v2/AlertV2';`, `import * as evaluateModule from '@/lib/alerting/evaluate';`, and `createAlertRuleInput` from `../../setup/factories`.

Append to `__tests__/integration/api/simulate-cron.integration.test.ts`:

```typescript
describe('alert evaluation on the cron path', () => {
  it('should evaluate rules against simulated readings', async () => {
    await DeviceV2.create(createDeviceInput({ _id: 'device_cron_01', type: 'temperature' }));
    await AlertRuleV2.create(
      createAlertRuleInput({
        name: 'Any temperature',
        metric: 'value',
        comparison: 'gt',
        threshold: -1000, // guaranteed to breach whatever the simulator emits
        severity: 'info',
        selector: { types: ['temperature'] },
      })
    );

    const response = await GET(createAuthorizedCronRequest()); // reuse the file's existing helper
    expect(response.status).toBe(200);

    expect(await AlertV2.countDocuments({ status: 'firing' })).toBeGreaterThan(0);
  });

  it('should sweep an alert whose device no longer reports', async () => {
    await DeviceV2.create(createDeviceInput({ _id: 'device_cron_02', type: 'temperature' }));
    await AlertV2.create(
      createAlertInput({ device_id: 'device_ghost', status: 'firing', is_open: true })
    );

    await GET(createAuthorizedCronRequest());

    const swept = await AlertV2.findOne({ device_id: 'device_ghost' }).lean();
    expect(swept!.status).toBe('resolved');
    expect(swept!.audit.resolution).toBe('device_inactive');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test __tests__/integration/api/readings-ingest.integration.test.ts __tests__/integration/api/simulate-cron.integration.test.ts`
Expected: FAIL — no alerts are created; the new assertions fail.

- [ ] **Step 3: Wire the ingest route**

In `app/api/v2/readings/ingest/route.ts`, add the import:

```typescript
import { safeEvaluateReadings } from '@/lib/alerting';
```

Widen the device query (currently at lines 144-147) so evaluation adds no query of its own:

```typescript
    // Validate that devices exist (batch check). The projection carries every
    // field the alert selector needs — evaluation reuses this result rather than
    // issuing a second device query.
    const existingDevices = await DeviceV2.find(
      { _id: { $in: deviceIds }, 'audit.deleted_at': { $exists: false } },
      { _id: 1, type: 1, location: 1, 'metadata.tags': 1 }
    ).lean();
```

Then, immediately after the `if (results.inserted > 0) { ... }` block that updates `health.last_seen` and invalidates the readings cache, and **before** `recordIngestion`:

```typescript
    // Evaluate alert rules. Runs strictly after the inserts have committed and
    // cannot affect them; safeEvaluateReadings never throws.
    if (results.inserted > 0)
      await safeEvaluateReadings(
        validReadings,
        existingDevices as unknown as Parameters<typeof safeEvaluateReadings>[1]
      );
```

- [ ] **Step 4: Wire the cron route**

In `app/api/v2/cron/simulate/route.ts`, add:

```typescript
import { safeEvaluateReadings, safeSweepStaleAlerts } from '@/lib/alerting';
import type { IDeviceV2 } from '@/models/v2/DeviceV2';
```

Widen the device query. `SimulatedDevice` is `Pick<IDeviceV2, '_id' | 'type' | 'location'>`, so widen the lean cast rather than dropping the tags on the floor:

```typescript
    type CronDevice = SimulatedDevice & Pick<IDeviceV2, 'metadata'>;

    const devices = await DeviceV2.findActive()
      .select({ _id: 1, type: 1, location: 1, 'metadata.tags': 1 })
      .lean<CronDevice[]>();
```

After the Pusher trigger block (`route.ts:62-70`) and before the anomaly count:

```typescript
    // 4. Evaluate alert rules against the readings we just wrote.
    await safeEvaluateReadings(newReadings, devices);

    // 5. Sweep alerts whose device has stopped reporting. Cron path only — the
    //    reporting set is the devices we just emitted for, so this needs no
    //    device query of its own.
    await safeSweepStaleAlerts(new Set(devices.map(device => String(device._id))));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test __tests__/integration/api/readings-ingest.integration.test.ts __tests__/integration/api/simulate-cron.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify no regression across the whole suite**

Run: `npx tsc --noEmit && pnpm test`
Expected: full suite green. Coverage thresholds (`branches 55, functions 55, lines 75, statements 75`) must still hold — if `pnpm test:coverage` drops below them, the alerting modules need the missing branches covered before moving on.

- [ ] **Step 7: Commit**

```bash
git add app/api/v2/readings/ingest/route.ts app/api/v2/cron/simulate/route.ts __tests__/integration/api/readings-ingest.integration.test.ts __tests__/integration/api/simulate-cron.integration.test.ts
git commit -m "feat(alerting): evaluate alert rules on both write paths"
```

---

### Task 10: Alerts API — `GET /api/v2/alerts`, `GET|PATCH /api/v2/alerts/[id]`

**Files:**
- Create: `app/api/v2/alerts/route.ts`
- Create: `app/api/v2/alerts/[id]/route.ts`
- Test: `__tests__/integration/api/alerts.integration.test.ts`

**There is no `DELETE` on alerts.** An alert is resolved, never cancelled and never removed — the history is the point. Transitions go through `PATCH { status }` dispatching to the atomic statics, following `ScheduleV2`, not through action sub-routes.

**Interfaces:**
- Consumes: `AlertV2`, `AlertTransitionError`, `AlertTransitionCode` (Task 2); `listAlertsQuerySchema`, `getAlertQuerySchema`, `updateAlertSchema`, `alertIdParamSchema` (Task 3); new `ErrorCodes` (Task 2); `recordAlert` (Task 4).
- Produces:
  - `GET /api/v2/alerts` → `jsonPaginated(AlertV2Response[])`, defaults to open alerts (`firing` + `acknowledged`), **never returns `pending`**
  - `GET /api/v2/alerts/[id]` → `jsonSuccess(AlertV2Response)`
  - `PATCH /api/v2/alerts/[id]` → `jsonSuccess(AlertV2Response)`
  - Exported `const PATCH = withRateLimit(withRequestValidation(handleUpdateAlert, ValidationPresets.jsonApi))`

- [ ] **Step 1: Write the failing integration test**

Create `__tests__/integration/api/alerts.integration.test.ts`:

```typescript
/**
 * Alerts API Integration Tests
 */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import AlertV2 from '@/models/v2/AlertV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createAlertInput, createDeviceInput, resetCounters } from '../../setup/factories';
import { mockAuthAsAdmin, mockAuthAsMember } from '../../setup/auth-helpers';

import { GET as listAlerts } from '@/app/api/v2/alerts/route';
import { GET as getAlert, PATCH } from '@/app/api/v2/alerts/[id]/route';

function createMockGetRequest(path: string, searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function createMockPatchRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Alerts API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
    mockAuthAsAdmin();
  });

  describe('GET /api/v2/alerts', () => {
    it('should default to open alerts and exclude pending and resolved', async () => {
      await AlertV2.create(createAlertInput({ status: 'firing' }));
      await AlertV2.create(createAlertInput({ status: 'acknowledged' }));
      await AlertV2.create(createAlertInput({ status: 'pending' }));
      await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts'));
      const body = await parseResponse<{ data: Array<{ status: string }> }>(response);

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.data.map(a => a.status).sort()).toEqual(['acknowledged', 'firing']);
    });

    it('should never return pending even when explicitly requested', async () => {
      await AlertV2.create(createAlertInput({ status: 'pending' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { status: 'pending' }));
      const body = await parseResponse<{ data: unknown[] }>(response);

      expect(body.data).toHaveLength(0);
    });

    it('should return history when status=resolved', async () => {
      await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { status: 'resolved' }));
      const body = await parseResponse<{ data: unknown[] }>(response);

      expect(body.data).toHaveLength(1);
    });

    it('should filter by severity', async () => {
      await AlertV2.create(createAlertInput({ status: 'firing', severity: 'critical' }));
      await AlertV2.create(createAlertInput({ status: 'firing', severity: 'info' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { severity: 'critical' }));
      const body = await parseResponse<{ data: Array<{ severity: string }> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].severity).toBe('critical');
    });

    it('should filter by device_id', async () => {
      await AlertV2.create(createAlertInput({ status: 'firing', device_id: 'device_aaa' }));
      await AlertV2.create(createAlertInput({ status: 'firing', device_id: 'device_bbb' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { device_id: 'device_aaa' }));
      const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].device_id).toBe('device_aaa');
    });

    it('should paginate', async () => {
      for (let i = 0; i < 5; i++) await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await listAlerts(
        createMockGetRequest('/api/v2/alerts', { page: '2', limit: '2' })
      );
      const body = await parseResponse<{ data: unknown[]; pagination: { total: number; page: number } }>(response);

      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(5);
      expect(body.pagination.page).toBe(2);
    });

    it('should reject an invalid query parameter with 400', async () => {
      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { severity: 'nuclear' }));
      expect(response.status).toBe(400);
    });

    it('should allow a member to read', async () => {
      mockAuthAsMember();
      await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts'));
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/v2/alerts/[id]', () => {
    it('should return a single alert', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${alert._id}`),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: { _id: string } }>(response);

      expect(response.status).toBe(200);
      expect(body.data._id).toBe(String(alert._id));
    });

    it('should include device details when requested', async () => {
      await DeviceV2.create(createDeviceInput({ _id: 'device_detail' }));
      const alert = await AlertV2.create(
        createAlertInput({ status: 'firing', device_id: 'device_detail' })
      );

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${alert._id}`, { include_device: 'true' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: { device: { _id: string } | null } }>(response);

      expect(body.data.device?._id).toBe('device_detail');
    });

    it('should return null device when the device is gone', async () => {
      const alert = await AlertV2.create(
        createAlertInput({ status: 'firing', device_id: 'device_vanished' })
      );

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${alert._id}`, { include_device: 'true' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: { device: unknown } }>(response);

      expect(body.data.device).toBeNull();
    });

    it('should 404 for an unknown id', async () => {
      const id = String(new Types.ObjectId());

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${id}`),
        { params: params(id) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('ALERT_NOT_FOUND');
    });

    it('should 400 for a malformed id', async () => {
      const response = await getAlert(
        createMockGetRequest('/api/v2/alerts/nope'),
        { params: params('nope') }
      );
      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /api/v2/alerts/[id]', () => {
    it('should acknowledge a firing alert', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: { status: string; is_open: boolean } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe('acknowledged');
      expect(body.data.is_open).toBe(true);
    });

    it('should resolve a firing alert and record a manual resolution', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'resolved', note: 'Swapped sensor' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{
        data: { status: string; is_open: boolean; audit: { resolution: string; note?: string } };
      }>(response);

      expect(body.data.status).toBe('resolved');
      expect(body.data.is_open).toBe(false);
      expect(body.data.audit.resolution).toBe('manual');
      expect(body.data.audit.note).toBe('Swapped sensor');
    });

    it('should return 422 ALERT_ALREADY_ACKNOWLEDGED', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'acknowledged' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('ALERT_ALREADY_ACKNOWLEDGED');
    });

    it('should return 422 ALERT_ALREADY_RESOLVED', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'resolved' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('ALERT_ALREADY_RESOLVED');
    });

    it('should return 422 INVALID_ALERT_STATUS_TRANSITION for a pending alert', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'pending' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('INVALID_ALERT_STATUS_TRANSITION');
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );

      expect(response.status).toBe(403);
    });

    it('should 400 for an unsupported status', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'firing' }),
        { params: params(String(alert._id)) }
      );

      expect(response.status).toBe(400);
    });

    it('should 404 for an unknown id', async () => {
      const id = String(new Types.ObjectId());

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${id}`, { status: 'acknowledged' }),
        { params: params(id) }
      );

      expect(response.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/integration/api/alerts.integration.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write the list route**

Create `app/api/v2/alerts/route.ts`:

```typescript
/**
 * V2 Alerts API Route
 *
 * GET /api/v2/alerts - List alerts with pagination, filtering, and sorting
 *
 * Defaults to OPEN alerts (firing + acknowledged) and NEVER returns `pending`.
 * `pending` is an internal state: it is what makes for_duration_seconds work
 * without a second state store, it raises no notification, and it is deleted
 * rather than resolved when the condition clears.
 *
 * Deliberately NOT cached. The list changes on every ingest and is already pushed
 * over Pusher; a cache-aside layer would add staleness in exchange for nothing.
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertV2 from '@/models/v2/AlertV2';
import {
  listAlertsQuerySchema,
  type ListAlertsQuery,
} from '@/lib/validations/v2/alert.validation';
import { validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonPaginated } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireOrgMembership } from '@/lib/auth';

/** Statuses a client may ever see. `pending` is internal and always excluded. */
const VISIBLE_STATUSES = ['firing', 'acknowledged', 'resolved'] as const;
const OPEN_STATUSES = ['firing', 'acknowledged'] as const;

const SORT_FIELD_MAP: Record<string, string> = {
  created_at: 'audit.created_at',
  fired_at: 'fired_at',
  severity: 'severity',
  status: 'status',
  last_observed_at: 'last_observed_at',
};

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const validationResult = validateQuery(request.nextUrl.searchParams, listAlertsQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as ListAlertsQuery;
    const pagination = getOffsetPaginationParams({ page: query.page, limit: query.limit });

    const filter: Record<string, unknown> = {};

    // Intersect whatever the caller asked for with the visible set, so `pending`
    // can never leak through an explicit status filter.
    const requested = query.status
      ? (Array.isArray(query.status) ? query.status : [query.status])
      : [...OPEN_STATUSES];
    const statuses = requested.filter(s => (VISIBLE_STATUSES as readonly string[]).includes(s));
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };

    if (query.severity) {
      const severities = Array.isArray(query.severity) ? query.severity : [query.severity];
      filter.severity = severities.length === 1 ? severities[0] : { $in: severities };
    }

    if (query.device_id) filter.device_id = query.device_id;
    if (query.rule_id) filter.rule_id = query.rule_id;

    // Filter on `fired_at`, the domain event — NOT `audit.created_at`, which is
    // stamped when the invisible `pending` episode is first created. With a
    // non-zero for_duration_seconds those differ by the whole duration, so a
    // client asking "which alerts fired in this window" would get the wrong set.
    // Matches how readings filter on `timestamp` and schedules on
    // `scheduled_date`. Every visible alert has `fired_at`: pending episodes are
    // deleted rather than resolved, so they never reach a client.
    if (query.startDate || query.endDate) {
      const range: Record<string, Date> = {};
      if (query.startDate) range.$gte = new Date(query.startDate);
      if (query.endDate) range.$lte = new Date(query.endDate);
      filter.fired_at = range;
    }

    const sortField = SORT_FIELD_MAP[query.sortBy ?? 'created_at'] ?? 'audit.created_at';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortDirection === 'asc' ? 1 : -1 };

    const [alerts, total] = await Promise.all([
      AlertV2.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit).lean(),
      AlertV2.countDocuments(filter),
    ]);

    const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/alerts', 200, duration);
    logger.debug('Alerts list request', { duration, total, statuses });

    return jsonPaginated(alerts, paginationInfo);
  })();
}
```

- [ ] **Step 4: Write the single-alert route**

Create `app/api/v2/alerts/[id]/route.ts`:

```typescript
/**
 * V2 Single Alert API Routes
 *
 * GET   /api/v2/alerts/[id] - Get a single alert
 * PATCH /api/v2/alerts/[id] - Acknowledge or resolve
 *
 * There is no DELETE. An alert is resolved, never cancelled and never removed —
 * the history is the point.
 *
 * Status Transition Rules:
 *   firing       -> acknowledged | resolved
 *   acknowledged -> resolved
 *   resolved     -> (terminal)
 *   pending      -> (internal; not a legal PATCH target)
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertV2, {
  AlertTransitionError,
  type AlertTransitionCode,
} from '@/models/v2/AlertV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  updateAlertSchema,
  getAlertQuerySchema,
  alertIdParamSchema,
  type GetAlertQuery,
} from '@/lib/validations/v2/alert.validation';
import { validateInput, validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';
import { logger, recordRequest, createRequestTimer, recordAlert } from '@/lib/monitoring';

// ============================================================================
// GET /api/v2/alerts/[id]
// ============================================================================

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const { id } = await params;

    const paramValidation = validateInput({ id }, alertIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    const queryValidation = validateQuery(request.nextUrl.searchParams, getAlertQuerySchema);
    if (!queryValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        queryValidation.errors.map(e => e.message).join(', '),
        { errors: queryValidation.errors }
      );

    const query = queryValidation.data as GetAlertQuery;

    const alert = await AlertV2.findById(id).lean();
    if (!alert) throw new ApiError(ErrorCodes.ALERT_NOT_FOUND, 404, `Alert '${id}' not found`);

    const response: Record<string, unknown> = { ...alert };

    if (query.include_device) {
      const device = await DeviceV2.findById(alert.device_id)
        .select('_id serial_number type location')
        .lean();

      response.device = device
        ? {
            _id: device._id,
            serial_number: device.serial_number,
            type: device.type,
            location: {
              building_id: device.location?.building_id,
              floor: device.location?.floor,
              room_name: device.location?.room_name,
            },
          }
        : null;

      if (!device)
        logger.warn('Device not found for alert', { alertId: id, deviceId: alert.device_id });
    }

    recordRequest('GET', '/api/v2/alerts/[id]', 200, timer.elapsed());

    return jsonSuccess(response);
  })();
}

// ============================================================================
// ERROR MAPPING HELPER
// ============================================================================

/**
 * Three codes, not four. ScheduleV2 needs four because its two terminal targets
 * are symmetric — either can block the other. Alerts are not symmetric:
 * `acknowledged` sits between `firing` and `resolved`.
 */
const TRANSITION_CODE_MAP: Record<AlertTransitionCode, { code: string; message: string }> = {
  ALREADY_ACKNOWLEDGED: {
    code: ErrorCodes.ALERT_ALREADY_ACKNOWLEDGED,
    message: 'Alert is already acknowledged',
  },
  ALREADY_RESOLVED: {
    code: ErrorCodes.ALERT_ALREADY_RESOLVED,
    message: 'Alert is already resolved',
  },
  NOT_YET_FIRING: {
    code: ErrorCodes.INVALID_ALERT_STATUS_TRANSITION,
    message: 'Alert has not fired yet and cannot be acknowledged or resolved',
  },
};

function rethrowAsApiError(error: unknown): never {
  if (error instanceof AlertTransitionError) {
    const mapped = TRANSITION_CODE_MAP[error.code];
    throw new ApiError(mapped.code, 422, mapped.message);
  }
  throw error;
}

// ============================================================================
// PATCH /api/v2/alerts/[id]
// ============================================================================

async function handleUpdateAlert(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;

    const paramValidation = validateInput({ id }, alertIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    const bodyValidation = await validateBody(request, updateAlertSchema);
    if (!bodyValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );

    const { status, note } = bodyValidation.data;

    const updated =
      status === 'acknowledged'
        ? await AlertV2.acknowledge(id, auditUser).catch(rethrowAsApiError)
        : await AlertV2.resolve(id, auditUser, 'manual').catch(rethrowAsApiError);

    if (!updated) throw new ApiError(ErrorCodes.ALERT_NOT_FOUND, 404, `Alert '${id}' not found`);

    if (note) {
      updated.audit.note = note;
      await updated.save();
    }

    if (status === 'resolved') recordAlert('resolved', { resolution: 'manual' });

    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/alerts/[id]', 200, duration);
    logger.info('Alert transitioned', { alertId: id, status, by: auditUser, duration });

    return jsonSuccess(
      updated.toObject(),
      status === 'acknowledged' ? 'Alert acknowledged' : 'Alert resolved'
    );
  })();
}

export const PATCH = withRateLimit(
  withRequestValidation(handleUpdateAlert, ValidationPresets.jsonApi)
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/integration/api/alerts.integration.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/v2/alerts __tests__/integration/api/alerts.integration.test.ts
git commit -m "feat(alerting): add alerts API with atomic PATCH transitions"
```

---

### Task 11: Alert rules API — `/api/v2/alert-rules` and `/api/v2/alert-rules/[id]`

Rules live at `/api/v2/alert-rules`, not `/api/v2/alerts/rules`, so that no static segment competes with the `[id]` dynamic segment. Hyphenated resource names are already established (`temperature-correlation`, `maintenance-forecast`).

**Files:**
- Create: `app/api/v2/alert-rules/route.ts`
- Create: `app/api/v2/alert-rules/[id]/route.ts`
- Test: `__tests__/integration/api/alert-rules.integration.test.ts`

**Interfaces:**
- Consumes: `AlertRuleV2` (Task 1); `createAlertRuleSchema`, `updateAlertRuleSchema`, `listAlertRulesQuerySchema`, `alertRuleIdParamSchema` (Task 3); `invalidateAlertRules` (Task 4).
- Produces:
  - `GET /api/v2/alert-rules` → `jsonPaginated(AlertRuleV2Response[])` (excludes soft-deleted)
  - `POST /api/v2/alert-rules` → `jsonSuccess(AlertRuleV2Response, msg, 201)`
  - `GET /api/v2/alert-rules/[id]` → `jsonSuccess(AlertRuleV2Response)`
  - `PATCH /api/v2/alert-rules/[id]` → `jsonSuccess(AlertRuleV2Response)`
  - `DELETE /api/v2/alert-rules/[id]` → `jsonSuccess({ _id, deleted: true, deleted_at })` (soft delete)

**Every mutation must call `await invalidateAlertRules()`** — otherwise a new or edited rule takes up to 60 seconds to affect evaluation, which is exactly the kind of "it didn't work, oh wait now it does" behaviour that makes an alerting system untrustworthy.

- [ ] **Step 1: Write the failing integration test**

Create `__tests__/integration/api/alert-rules.integration.test.ts`:

```typescript
/**
 * Alert Rules API Integration Tests
 */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import { createAlertRuleInput, resetCounters } from '../../setup/factories';
import { mockAuthAsAdmin, mockAuthAsMember } from '../../setup/auth-helpers';

import { GET as listRules, POST } from '@/app/api/v2/alert-rules/route';
import { GET as getRule, PATCH, DELETE } from '@/app/api/v2/alert-rules/[id]/route';

function get(path: string, searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function withBody(path: string, method: 'POST' | 'PATCH', body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

const VALID_BODY = {
  name: 'High temperature',
  metric: 'value',
  comparison: 'gt',
  threshold: 30,
  severity: 'critical',
  selector: { types: ['temperature'] },
  for_duration_seconds: 300,
};

describe('Alert Rules API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
    mockAuthAsAdmin();
  });

  describe('GET /api/v2/alert-rules', () => {
    it('should list rules and exclude soft-deleted ones', async () => {
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Kept' }));
      const gone = await AlertRuleV2.create(createAlertRuleInput({ name: 'Gone' }));
      await AlertRuleV2.softDelete(String(gone._id), 'admin');

      const response = await listRules(get('/api/v2/alert-rules'));
      const body = await parseResponse<{ data: Array<{ name: string }> }>(response);

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Kept');
    });

    it('should filter by enabled', async () => {
      await AlertRuleV2.create(createAlertRuleInput({ name: 'On' }));
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Off', enabled: false }));

      const response = await listRules(get('/api/v2/alert-rules', { enabled: 'false' }));
      const body = await parseResponse<{ data: Array<{ name: string }> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Off');
    });

    it('should allow a member to read', async () => {
      mockAuthAsMember();
      const response = await listRules(get('/api/v2/alert-rules'));
      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/v2/alert-rules', () => {
    it('should create a rule with audit and defaults', async () => {
      const response = await POST(withBody('/api/v2/alert-rules', 'POST', VALID_BODY));
      const body = await parseResponse<{
        data: { _id: string; enabled: boolean; cooldown_seconds: number; audit: { created_by: string } };
      }>(response);

      expect(response.status).toBe(201);
      expect(body.data.enabled).toBe(true);
      expect(body.data.cooldown_seconds).toBe(300);
      expect(body.data.audit.created_by).toBeTruthy();
      expect(await AlertRuleV2.countDocuments({})).toBe(1);
    });

    it("should 400 when metric is 'value' and selector.types is missing", async () => {
      const response = await POST(
        withBody('/api/v2/alert-rules', 'POST', { ...VALID_BODY, selector: {} })
      );
      expect(response.status).toBe(400);
    });

    it('should 400 when the threshold is outside the metric bounds', async () => {
      const response = await POST(
        withBody('/api/v2/alert-rules', 'POST', {
          ...VALID_BODY,
          metric: 'anomaly_score',
          threshold: 30,
          selector: {},
        })
      );
      expect(response.status).toBe(400);
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const response = await POST(withBody('/api/v2/alert-rules', 'POST', VALID_BODY));
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v2/alert-rules/[id]', () => {
    it('should return a single rule', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput({ name: 'Solo' }));

      const response = await getRule(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ data: { name: string } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('Solo');
    });

    it('should 404 for a soft-deleted rule', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());
      await AlertRuleV2.softDelete(String(rule._id), 'admin');

      const response = await getRule(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('ALERT_RULE_NOT_FOUND');
    });

    it('should 404 for an unknown id', async () => {
      const id = String(new Types.ObjectId());
      const response = await getRule(get(`/api/v2/alert-rules/${id}`), { params: params(id) });
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/v2/alert-rules/[id]', () => {
    it('should toggle enabled', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{ data: { enabled: boolean } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.enabled).toBe(false);
    });

    it('should update the full condition group', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', {
          metric: 'value',
          comparison: 'gte',
          threshold: 45,
          selector: { types: ['temperature', 'humidity'] },
        }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{ data: { threshold: number } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.threshold).toBe(45);
    });

    it('should 400 on a partial condition update', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { threshold: 45 }),
        { params: params(String(rule._id)) }
      );

      expect(response.status).toBe(400);
    });

    it('should 400 on an empty body', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', {}), {
        params: params(String(rule._id)),
      });

      expect(response.status).toBe(400);
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/v2/alert-rules/[id]', () => {
    it('should soft delete, preserving the document', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await DELETE(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ data: { deleted: boolean } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.deleted).toBe(true);

      // Soft, not hard: alerts reference their rule, and hard-deleting would
      // orphan the history that justifies every alert it ever raised.
      const stored = await AlertRuleV2.findById(rule._id).lean();
      expect(stored).not.toBeNull();
      expect(stored!.audit.deleted_at).toBeTruthy();
    });

    it('should 404 when already deleted', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());
      await AlertRuleV2.softDelete(String(rule._id), 'admin');

      const response = await DELETE(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });

      expect(response.status).toBe(404);
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await DELETE(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });

      expect(response.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/integration/api/alert-rules.integration.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write the collection route**

Create `app/api/v2/alert-rules/route.ts`:

```typescript
/**
 * V2 Alert Rules API Routes
 *
 * GET  /api/v2/alert-rules - List rules (soft-deleted excluded)
 * POST /api/v2/alert-rules - Create a rule
 *
 * Path is `/api/v2/alert-rules` rather than `/api/v2/alerts/rules` so that no
 * static segment competes with the `[id]` dynamic segment under /alerts.
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import {
  createAlertRuleSchema,
  listAlertRulesQuerySchema,
  type ListAlertRulesQuery,
} from '@/lib/validations/v2/alert-rule.validation';
import { validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess, jsonPaginated } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { invalidateAlertRules } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';

const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  created_at: 'audit.created_at',
  updated_at: 'audit.updated_at',
  severity: 'severity',
};

// ============================================================================
// GET /api/v2/alert-rules
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const validationResult = validateQuery(request.nextUrl.searchParams, listAlertRulesQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as ListAlertRulesQuery;
    const pagination = getOffsetPaginationParams({ page: query.page, limit: query.limit });

    const filter: Record<string, unknown> = { 'audit.deleted_at': { $exists: false } };
    if (query.enabled !== undefined) filter.enabled = query.enabled;
    if (query.metric) filter.metric = query.metric;
    if (query.severity) filter.severity = query.severity;

    const sortField = SORT_FIELD_MAP[query.sortBy ?? 'created_at'] ?? 'audit.created_at';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortDirection === 'asc' ? 1 : -1 };

    const [rules, total] = await Promise.all([
      AlertRuleV2.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit).lean(),
      AlertRuleV2.countDocuments(filter),
    ]);

    recordRequest('GET', '/api/v2/alert-rules', 200, timer.elapsed());

    return jsonPaginated(
      rules,
      calculateOffsetPagination(total, pagination.page, pagination.limit)
    );
  })();
}

// ============================================================================
// POST /api/v2/alert-rules
// ============================================================================

async function handleCreateAlertRule(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const bodyValidation = await validateBody(request, createAlertRuleSchema);
    if (!bodyValidation.success) {
      logger.validationFailure('/api/v2/alert-rules', bodyValidation.errors);
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );
    }

    const now = new Date();
    const created = await AlertRuleV2.create({
      ...bodyValidation.data,
      audit: {
        created_at: now,
        created_by: auditUser,
        updated_at: now,
        updated_by: auditUser,
      },
    });

    // Without this the new rule takes up to 60s to affect evaluation.
    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('POST', '/api/v2/alert-rules', 201, duration);
    logger.info('Alert rule created', { ruleId: String(created._id), createdBy: auditUser, duration });

    return jsonSuccess(created.toObject(), 'Alert rule created successfully', 201);
  })();
}

export const POST = withRateLimit(
  withRequestValidation(handleCreateAlertRule, ValidationPresets.jsonApi)
);
```

- [ ] **Step 4: Write the single-rule route**

Create `app/api/v2/alert-rules/[id]/route.ts`:

```typescript
/**
 * V2 Single Alert Rule API Routes
 *
 * GET    /api/v2/alert-rules/[id] - Get a rule
 * PATCH  /api/v2/alert-rules/[id] - Update a rule
 * DELETE /api/v2/alert-rules/[id] - Soft delete a rule
 *
 * DELETE is SOFT. Alerts reference their rule; hard-deleting would orphan the
 * history that justifies every alert it ever raised. `enabled: false` is the
 * reversible off switch; deletion is the permanent one.
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import {
  updateAlertRuleSchema,
  alertRuleIdParamSchema,
} from '@/lib/validations/v2/alert-rule.validation';
import { validateInput, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { invalidateAlertRules } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';

function assertValidId(id: string): void {
  const paramValidation = validateInput({ id }, alertRuleIdParamSchema);
  if (!paramValidation.success)
    throw new ApiError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      paramValidation.errors.map(e => e.message).join(', '),
      { errors: paramValidation.errors }
    );
}

// ============================================================================
// GET
// ============================================================================

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const rule = await AlertRuleV2.findOne({
      _id: id,
      'audit.deleted_at': { $exists: false },
    }).lean();

    if (!rule)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    recordRequest('GET', '/api/v2/alert-rules/[id]', 200, timer.elapsed());

    return jsonSuccess(rule);
  })();
}

// ============================================================================
// PATCH
// ============================================================================

async function handleUpdateAlertRule(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const bodyValidation = await validateBody(request, updateAlertRuleSchema);
    if (!bodyValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );

    const updated = await AlertRuleV2.findOneAndUpdate(
      { _id: id, 'audit.deleted_at': { $exists: false } },
      {
        $set: {
          ...bodyValidation.data,
          'audit.updated_at': new Date(),
          'audit.updated_by': auditUser,
        },
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updated)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/alert-rules/[id]', 200, duration);
    logger.info('Alert rule updated', {
      ruleId: id,
      updates: Object.keys(bodyValidation.data),
      updatedBy: auditUser,
      duration,
    });

    return jsonSuccess(updated, 'Alert rule updated successfully');
  })();
}

export const PATCH = withRateLimit(
  withRequestValidation(handleUpdateAlertRule, ValidationPresets.jsonApi)
);

// ============================================================================
// DELETE
// ============================================================================

async function handleDeleteAlertRule(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const deleted = await AlertRuleV2.softDelete(id, auditUser);

    if (!deleted)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('DELETE', '/api/v2/alert-rules/[id]', 200, duration);
    logger.info('Alert rule deleted', { ruleId: id, deletedBy: auditUser, duration });

    return jsonSuccess(
      { _id: id, deleted: true, deleted_at: deleted.audit?.deleted_at },
      'Alert rule deleted successfully'
    );
  })();
}

export const DELETE = withRateLimit(handleDeleteAlertRule);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/integration/api/alert-rules.integration.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Confirm the v2 surface is now 33 endpoints**

Run: `pnpm test __tests__/integration/api && npx tsc --noEmit`
Expected: all integration suites green. The v2 API has gone from 25 endpoints to 33.

- [ ] **Step 7: Commit**

```bash
git add app/api/v2/alert-rules __tests__/integration/api/alert-rules.integration.test.ts
git commit -m "feat(alerting): add alert rules API with soft delete and cache invalidation"
```

---

### Task 12: API client, React Query hooks, and a correct severity sort

**Files:**
- Modify: `app/api/v2/alerts/route.ts` (Step 0 — make `sortBy=severity` order by urgency)
- Modify: `__tests__/integration/api/alerts.integration.test.ts` (Step 0 — replace the test that pins the lexical order)
- Modify: `lib/api/v2-client.ts`
- Modify: `lib/query/queryClient.ts`
- Create: `lib/query/hooks/useAlerts.ts`
- Create: `lib/query/hooks/useAlertRules.ts`
- Modify: `lib/query/hooks/index.ts`
- Test: `__tests__/unit/lib/v2-client-alerts.test.ts`
- Test: `__tests__/unit/lib/useAlerts.test.tsx` — **`.tsx`, not `.ts`** (see Step 6)

**Interfaces:**
- Consumes: wire types from `@/types/v2` (Task 3); the routes from Tasks 10–11.
- Produces:
  - `v2Api.alerts.list(query)`, `.getById(id, options)`, `.acknowledge(id, note?)`, `.resolve(id, note?)`
  - `v2Api.alertRules.list(query)`, `.getById(id)`, `.create(data)`, `.update(id, data)`, `.delete(id)`
  - `queryKeys.alerts.all` / `.list(filters)` / `.detail(id)`; `queryKeys.alertRules.all` / `.list(filters)` / `.detail(id)`
  - `useAlertsList(filters, config)`, `useAlertDetail(id, options, config)`, `useOpenAlertCount()`, `useAcknowledgeAlert()`, `useResolveAlert()`
  - `useAlertRulesList(filters, config)`, `useAlertRuleDetail(id, config)`, `useCreateAlertRule()`, `useUpdateAlertRule()`, `useDeleteAlertRule()`

- [ ] **Step 0: Make `sortBy=severity` order by urgency**

`SORT_FIELD_MAP.severity` maps to the raw string field (`app/api/v2/alerts/route.ts:43`), so Mongo sorts it **lexically**: `critical` < `info` < `warning`. Descending — what a caller means by "most severe first" — therefore returns **warning → info → critical**, with critical dead last. Task 18's dashboard widget asks for exactly this sort, and Task 12 is where the client first exposes `sortBy: 'severity'` to callers, so the contract is made true here, before anything depends on it. Human ruling: fix the API rather than work around it in one component.

Keep `.find()` for every other sort field; branch only for `severity`:

```typescript
/** Urgency rank. Mongo sorts the raw string lexically, which puts `critical` last. */
const SEVERITY_RANK = {
  $switch: {
    branches: [
      { case: { $eq: ['$severity', 'critical'] }, then: 3 },
      { case: { $eq: ['$severity', 'warning'] }, then: 2 },
    ],
    default: 1, // info
  },
};
```

```typescript
    const direction: 1 | -1 = query.sortDirection === 'asc' ? 1 : -1;

    const alertsQuery =
      query.sortBy === 'severity'
        ? AlertV2.aggregate([
            { $match: filter },
            { $addFields: { _severity_rank: SEVERITY_RANK } },
            // fired_at breaks ties so paging is stable within a severity band.
            { $sort: { _severity_rank: direction, fired_at: -1 } },
            { $skip: pagination.skip },
            { $limit: pagination.limit },
            { $project: { __v: 0, _severity_rank: 0 } },
          ])
        : AlertV2.find(filter)
            .select('-__v')
            .sort(sort)
            .skip(pagination.skip)
            .limit(pagination.limit)
            .lean();

    const [alerts, total] = await Promise.all([alertsQuery, AlertV2.countDocuments(filter)]);
```

`aggregate()` already returns plain objects, so the response shape is identical to the `.lean()` path — no other part of the handler changes.

**Replace the test that pins the old behaviour.** `__tests__/integration/api/alerts.integration.test.ts` has `it('should sort by severity, not silently fall back to created_at')`, whose comment documents the lexical order as "an oddity, not a bug to fix here". It is being fixed here, so update the assertion **and** that comment. Keep the fixture's most valuable property: its three `audit.created_at` values are chosen so a collapsed `SORT_FIELD_MAP` falling back to `created_at` could not coincidentally satisfy the assertion. That still holds after the change —

| Order | Result |
| --- | --- |
| severity desc (**the fix**) | `device_crit`, `device_warn`, `device_info` |
| created_at desc (fallback) | `device_info`, `device_crit`, `device_warn` |
| created_at asc (fallback) | `device_warn`, `device_crit`, `device_info` |

— so change the expectation to `['device_crit', 'device_warn', 'device_info']` and keep the three distinct timestamps. Add one more case asserting `sortDirection: 'asc'` returns `['device_info', 'device_warn', 'device_crit']`, so the rank is proven to be ordered rather than merely different from lexical.

- [ ] **Step 1: Add the query keys**

In `lib/query/queryClient.ts`, add to the `queryKeys` object:

```typescript
  alerts: {
    all: ['alerts'] as const,
    list: (filters?: Record<string, unknown>) => ['alerts', 'list', filters] as const,
    detail: (id: string) => ['alerts', 'detail', id] as const,
  },
  alertRules: {
    all: ['alert-rules'] as const,
    list: (filters?: Record<string, unknown>) => ['alert-rules', 'list', filters] as const,
    detail: (id: string) => ['alert-rules', 'detail', id] as const,
  },
```

- [ ] **Step 2: Write the failing client test**

Create `__tests__/unit/lib/v2-client-alerts.test.ts`:

```typescript
/**
 * V2 API Client — Alerts and Alert Rules
 */

import { alertsApi, alertRulesApi } from '@/lib/api/v2-client';

const originalFetch = global.fetch;

function mockJson(data: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => ({ success: status < 400, data, timestamp: new Date().toISOString() }),
  }) as unknown as typeof fetch;
}

function calledUrl(): string {
  return (global.fetch as jest.Mock).mock.calls[0][0] as string;
}

function calledInit(): RequestInit {
  return (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('alertsApi', () => {
  it('should build the list URL with filters', async () => {
    mockJson([]);
    await alertsApi.list({ status: 'firing', severity: 'critical', limit: 10 });

    const url = calledUrl();
    expect(url).toContain('/api/v2/alerts?');
    expect(url).toContain('status=firing');
    expect(url).toContain('severity=critical');
    expect(url).toContain('limit=10');
  });

  it('should request a single alert with include_device', async () => {
    mockJson({});
    await alertsApi.getById('507f1f77bcf86cd799439011', { include_device: true });

    expect(calledUrl()).toBe('/api/v2/alerts/507f1f77bcf86cd799439011?include_device=true');
  });

  it('should PATCH acknowledged', async () => {
    mockJson({});
    await alertsApi.acknowledge('507f1f77bcf86cd799439011');

    expect(calledInit().method).toBe('PATCH');
    expect(JSON.parse(calledInit().body as string)).toEqual({ status: 'acknowledged' });
  });

  it('should PATCH resolved with a note', async () => {
    mockJson({});
    await alertsApi.resolve('507f1f77bcf86cd799439011', 'Swapped sensor');

    expect(JSON.parse(calledInit().body as string)).toEqual({
      status: 'resolved',
      note: 'Swapped sensor',
    });
  });
});

describe('alertRulesApi', () => {
  it('should POST a new rule', async () => {
    mockJson({});
    await alertRulesApi.create({
      name: 'R',
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      severity: 'warning',
      selector: { types: ['temperature'] },
    });

    expect(calledUrl()).toBe('/api/v2/alert-rules');
    expect(calledInit().method).toBe('POST');
  });

  it('should DELETE a rule', async () => {
    mockJson({});
    await alertRulesApi.delete('507f1f77bcf86cd799439011');

    expect(calledUrl()).toBe('/api/v2/alert-rules/507f1f77bcf86cd799439011');
    expect(calledInit().method).toBe('DELETE');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/v2-client-alerts.test.ts`
Expected: FAIL — `alertsApi` is not exported.

- [ ] **Step 4: Add the client namespaces**

In `lib/api/v2-client.ts`, add the alert types to the existing `@/types/v2` import block (`AlertV2Response`, `AlertRuleV2Response`, `ListAlertsQueryParams`, `ListAlertRulesQueryParams`, `CreateAlertRuleBody`, `UpdateAlertRuleBody`), then add before the final `v2Api` object:

```typescript
// ============================================================================
// ALERTS API
// ============================================================================

export const alertsApi = {
  /**
   * List alerts. Defaults server-side to open alerts (firing + acknowledged);
   * `pending` is internal and is never returned.
   */
  async list(query: ListAlertsQueryParams = {}): Promise<PaginatedResponse<AlertV2Response>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/alerts${queryString}`);
  },

  async getById(
    id: string,
    options: { include_device?: boolean } = {}
  ): Promise<ApiSuccessResponse<AlertV2Response>> {
    const queryString = buildQueryString(options as Record<string, unknown>);
    return apiCall(`/api/v2/alerts/${id}${queryString}`);
  },

  async acknowledge(id: string, note?: string): Promise<ApiSuccessResponse<AlertV2Response>> {
    return apiCall(`/api/v2/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'acknowledged', ...(note ? { note } : {}) }),
    });
  },

  async resolve(id: string, note?: string): Promise<ApiSuccessResponse<AlertV2Response>> {
    return apiCall(`/api/v2/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', ...(note ? { note } : {}) }),
    });
  },
};

// ============================================================================
// ALERT RULES API
// ============================================================================

export const alertRulesApi = {
  async list(
    query: ListAlertRulesQueryParams = {}
  ): Promise<PaginatedResponse<AlertRuleV2Response>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/alert-rules${queryString}`);
  },

  async getById(id: string): Promise<ApiSuccessResponse<AlertRuleV2Response>> {
    return apiCall(`/api/v2/alert-rules/${id}`);
  },

  async create(data: CreateAlertRuleBody): Promise<ApiSuccessResponse<AlertRuleV2Response>> {
    return apiCall('/api/v2/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async update(
    id: string,
    data: UpdateAlertRuleBody
  ): Promise<ApiSuccessResponse<AlertRuleV2Response>> {
    return apiCall(`/api/v2/alert-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async delete(
    id: string
  ): Promise<ApiSuccessResponse<{ _id: string; deleted: boolean; deleted_at?: string }>> {
    return apiCall(`/api/v2/alert-rules/${id}`, { method: 'DELETE' });
  },
};
```

Add `alerts: alertsApi,` and `alertRules: alertRulesApi,` to the exported `v2Api` object.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/v2-client-alerts.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the failing hooks test**

Create `__tests__/unit/lib/useAlerts.test.tsx`.

**The `.tsx` extension is load-bearing, not cosmetic.** `jest.config.js` routes `**/__tests__/**/*.test.ts` to the **node** project and `**/__tests__/**/*.test.tsx` to the **jsdom** project. `renderHook` needs a DOM, so naming this file `.ts` puts it in node and it fails with no `document`.

Model it on `__tests__/unit/lib/useDeviceDetail.test.tsx` — the repo's precedent for a hook test with a real `QueryClient`. It opens with a `/** @jest-environment jsdom */` docblock; that is redundant once the extension is `.tsx`, but harmless and consistent, so keep it.

Do **not** model this on `__tests__/unit/lib/useSchedules.test.ts`, despite the sibling naming. That file has no `QueryClientProvider` at all — it replaces `@tanstack/react-query` wholesale with a mock that captures the arguments handed to `useQuery`/`useMutation`. That asserts what you passed React Query, not what React Query does with it, and cannot catch a broken `enabled` guard or a mis-wired `onSuccess`. Use a real `QueryClient` here.

```typescript
/**
 * useAlerts Hook Tests
 *
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAlertsList, useAlertDetail, useAcknowledgeAlert, useResolveAlert } from '@/lib/query/hooks/useAlerts';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: {
    alerts: {
      list: jest.fn(),
      getById: jest.fn(),
      acknowledge: jest.fn(),
      resolve: jest.fn(),
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useAlertsList', () => {
  it('should return the alerts array', async () => {
    (v2Api.alerts.list as jest.Mock).mockResolvedValue({ data: [{ _id: 'a1', status: 'firing' }] });

    const { result } = renderHook(() => useAlertsList({ status: 'firing' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ _id: 'a1', status: 'firing' }]);
    expect(v2Api.alerts.list).toHaveBeenCalledWith({ status: 'firing' });
  });

  it('should surface an error', async () => {
    (v2Api.alerts.list as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useAlertsList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useAlertDetail', () => {
  it('should be disabled without an id', () => {
    const { result } = renderHook(() => useAlertDetail(''), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(v2Api.alerts.getById).not.toHaveBeenCalled();
  });
});

describe('mutations', () => {
  it('should acknowledge', async () => {
    (v2Api.alerts.acknowledge as jest.Mock).mockResolvedValue({ data: { _id: 'a1', status: 'acknowledged' } });

    const { result } = renderHook(() => useAcknowledgeAlert(), { wrapper });
    result.current.mutate({ id: 'a1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alerts.acknowledge).toHaveBeenCalledWith('a1', undefined);
  });

  it('should resolve with a note', async () => {
    (v2Api.alerts.resolve as jest.Mock).mockResolvedValue({ data: { _id: 'a1', status: 'resolved' } });

    const { result } = renderHook(() => useResolveAlert(), { wrapper });
    result.current.mutate({ id: 'a1', note: 'fixed' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alerts.resolve).toHaveBeenCalledWith('a1', 'fixed');
  });
});
```

Add a `useOpenAlertCount` block too. It must assert the two properties that make the hook worth having, or it is only testing React Query:

```typescript
describe('useOpenAlertCount', () => {
  it('should read pagination.total, not the row count', async () => {
    (v2Api.alerts.list as jest.Mock).mockResolvedValue({
      data: [{ _id: 'a1' }],     // one row...
      pagination: { total: 143 }, // ...but 143 open alerts
    });

    const { result } = renderHook(() => useOpenAlertCount(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(143);
  });

  it('should request a single row rather than a full page', async () => {
    (v2Api.alerts.list as jest.Mock).mockResolvedValue({
      data: [],
      pagination: { total: 0 },
    });

    const { result } = renderHook(() => useOpenAlertCount(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(v2Api.alerts.list).toHaveBeenCalledWith({ limit: 1 });
  });
});
```

The first case is the one that matters: `data.length` is 1 and `total` is 143, so a hook that counted the array would return 1 and fail. Do not make them equal — that is exactly the shape of test that passes for the wrong reason.

- [ ] **Step 7: Write the hooks**

Create `lib/query/hooks/useAlerts.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '../queryClient';
import type { QueryConfig, MutationConfig } from '../types';
import type { AlertV2Response, ListAlertsQueryParams } from '@/types/v2';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * List alerts. Short staleTime: the list changes on every ingest and is patched
 * live by usePusherAlerts, so React Query is the fallback rather than the driver.
 */
export function useAlertsList(
  filters: ListAlertsQueryParams = {},
  config?: QueryConfig<AlertV2Response[]>
) {
  return useQuery({
    queryKey: queryKeys.alerts.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await v2Api.alerts.list(filters);
      return response.data;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

export function useAlertDetail(
  id: string,
  options: { include_device?: boolean } = {},
  config?: QueryConfig<AlertV2Response>
) {
  return useQuery({
    queryKey: queryKeys.alerts.detail(id),
    queryFn: async () => {
      const response = await v2Api.alerts.getById(id, options);
      return response.data;
    },
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

/**
 * Count of open alerts, for the nav badge.
 *
 * Reads `pagination.total` off a one-row page rather than counting a fetched
 * array. Counting `data.length` would be wrong twice over: the API caps `limit`
 * at 100 (`lib/validations/common.validation.ts:17`), so a real storm would
 * display a frozen "100"; and TopNav renders on every route, so it would pull
 * 100 full alert documents on every navigation to render one number.
 */
export function useOpenAlertCount(config?: QueryConfig<number>) {
  return useQuery({
    queryKey: queryKeys.alerts.list({ count: true }),
    queryFn: async () => {
      // No `status` filter — the server defaults to open (firing + acknowledged).
      const response = await v2Api.alerts.list({ limit: 1 });
      return response.pagination.total;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    ...config,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useAcknowledgeAlert(
  config?: MutationConfig<AlertV2Response, { id: string; note?: string }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const response = await v2Api.alerts.acknowledge(id, note);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
    ...config,
  });
}

export function useResolveAlert(
  config?: MutationConfig<AlertV2Response, { id: string; note?: string }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const response = await v2Api.alerts.resolve(id, note);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
    ...config,
  });
}
```

Create `lib/query/hooks/useAlertRules.ts` following the same shape, with `useAlertRulesList(filters, config)`, `useAlertRuleDetail(id, config)`, `useCreateAlertRule()`, `useUpdateAlertRule()` (variables `{ id, data }`), and `useDeleteAlertRule()` (variables `id: string`). Rules change almost never, so use `staleTime: 5 * 60 * 1000`. Every mutation invalidates `queryKeys.alertRules.all`, and `useUpdateAlertRule` / `useDeleteAlertRule` also invalidate `queryKeys.alertRules.detail(id)`.

Add both to `lib/query/hooks/index.ts`:

```typescript
export * from './useAlerts';
export * from './useAlertRules';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test __tests__/unit/lib/useAlerts.test.tsx __tests__/unit/lib/v2-client-alerts.test.ts __tests__/integration/api/alerts.integration.test.ts`
Expected: PASS, including the two rewritten severity-sort cases from Step 0.

Then the full gates: `npx tsc --noEmit && pnpm lint`
Expected: 0 errors, 0 problems.

- [ ] **Step 9: Commit**

Two commits — the API fix is independently reviewable and independently revertable, and it is the only change here that alters server behaviour:

```bash
git add app/api/v2/alerts/route.ts __tests__/integration/api/alerts.integration.test.ts
git commit -m "fix(alerting): sort alerts by severity rank, not lexically"

git add lib/api/v2-client.ts lib/query/queryClient.ts lib/query/hooks/useAlerts.ts lib/query/hooks/useAlertRules.ts lib/query/hooks/index.ts __tests__/unit/lib/v2-client-alerts.test.ts __tests__/unit/lib/useAlerts.test.tsx
git commit -m "feat(alerting): add alerts API client and React Query hooks"
```

---

### Task 13: Bounded Pusher delivery

**One trigger per evaluation is constant in call count, not in body size, and Pusher caps an event at 10 KB.** A floor-wide condition firing across hundreds of devices in one cron run would overflow that cap, the trigger would throw, and this design swallows Pusher failures — so the UI would silently miss the single most dramatic event it exists to display. The failure mode is exactly inverted from what alerting is for.

**Files:**
- Create: `lib/alerting/notify.ts`
- Modify: `lib/alerting/index.ts` (publish from `safeEvaluateReadings` and `safeSweepStaleAlerts`)
- Modify: `app/api/v2/alerts/[id]/route.ts` (broadcast manual resolutions, Step 5)
- Modify: `app/api/v2/cron/simulate/route.ts` (broadcast only persisted readings, Step 6)
- Test: `__tests__/unit/lib/alerting/notify.test.ts`
- Test: `__tests__/integration/api/alerts.integration.test.ts` (Step 5) and the cron route's integration test (Step 6)

**Interfaces:**
- Consumes: `FiredAlert`, `ResolvedAlert`, `AlertEvent` from `@/types/v2/alert.types` (Task 3); `pusherServer` from `@/lib/pusher`.
- Produces:
  - `export const ALERT_EVENT_NAME = 'alert-event'`, `ALERT_EVENT_MAX = 20`, `ALERT_EVENT_MAX_BYTES = 8192`
  - `export function buildFiredEnvelope(alerts: FiredAlert[]): AlertEvent | null`
  - `export function buildResolvedEnvelope(alerts: ResolvedAlert[]): AlertEvent | null`
  - `export async function publishAlertEvents(fired: FiredAlert[], resolved: ResolvedAlert[]): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/alerting/notify.test.ts`:

```typescript
/**
 * Bounded Pusher Alert Delivery Tests
 */

import {
  buildFiredEnvelope,
  buildResolvedEnvelope,
  publishAlertEvents,
  ALERT_EVENT_NAME,
  ALERT_EVENT_MAX,
} from '@/lib/alerting/notify';
import { pusherServer } from '@/lib/pusher';
import type { FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

jest.mock('@/lib/pusher', () => ({
  pusherServer: { trigger: jest.fn().mockResolvedValue(undefined) },
}));

function fired(i: number, severity: FiredAlert['severity'] = 'warning'): FiredAlert {
  return {
    _id: `alert_${i}`,
    rule_id: 'rule_1',
    rule_name: 'High temp',
    device_id: `device_${i}`,
    severity,
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    trigger_value: 35,
    fired_at: `2026-08-01T12:0${i % 10}:00.000Z`,
  };
}

function resolved(i: number): ResolvedAlert {
  return {
    _id: `alert_${i}`,
    rule_id: 'rule_1',
    device_id: `device_${i}`,
    severity: 'warning',
    resolution: 'auto',
    resolved_at: '2026-08-01T12:30:00.000Z',
    actor: 'system',
  };
}

beforeEach(() => {
  (pusherServer.trigger as jest.Mock).mockClear();
});

describe('buildFiredEnvelope', () => {
  it('should return null for an empty list', () => {
    expect(buildFiredEnvelope([])).toBeNull();
  });

  it('should tag a small batch as fired', () => {
    const envelope = buildFiredEnvelope([fired(1), fired(2)]);

    expect(envelope).toEqual({ kind: 'fired', alerts: [fired(1), fired(2)] });
  });

  it('should carry exactly ALERT_EVENT_MAX alerts without degrading', () => {
    const alerts = Array.from({ length: ALERT_EVENT_MAX }, (_, i) => fired(i));

    expect(buildFiredEnvelope(alerts)!.kind).toBe('fired');
  });

  it('should degrade to a storm above ALERT_EVENT_MAX', () => {
    const alerts = [
      ...Array.from({ length: 15 }, (_, i) => fired(i, 'critical')),
      ...Array.from({ length: 10 }, (_, i) => fired(i + 15, 'info')),
    ];

    const envelope = buildFiredEnvelope(alerts);

    expect(envelope).toMatchObject({
      kind: 'storm',
      count: 25,
      by_severity: { critical: 15, warning: 0, info: 10 },
    });
  });

  it('should set storm.since to the earliest fired_at', () => {
    const alerts = Array.from({ length: 25 }, (_, i) => fired(i));
    const envelope = buildFiredEnvelope(alerts) as { since: string };

    expect(envelope.since).toBe('2026-08-01T12:00:00.000Z');
  });

  it('should degrade to a storm when the measured body exceeds the byte cap', () => {
    // Under the count cap but over the byte cap: a long rule_name inflates each row.
    const alerts = Array.from({ length: 10 }, (_, i) => ({
      ...fired(i),
      rule_name: 'x'.repeat(2000),
    }));

    expect(buildFiredEnvelope(alerts)!.kind).toBe('storm');
  });
});

describe('buildResolvedEnvelope', () => {
  it('should apply the same bounds', () => {
    expect(buildResolvedEnvelope([])).toBeNull();
    expect(buildResolvedEnvelope([resolved(1)])!.kind).toBe('resolved');
    expect(
      buildResolvedEnvelope(Array.from({ length: 25 }, (_, i) => resolved(i)))!.kind
    ).toBe('storm');
  });
});

describe('publishAlertEvents', () => {
  it('should send both envelopes on the single alert-event name', async () => {
    await publishAlertEvents([fired(1)], [resolved(2)]);

    expect(pusherServer.trigger).toHaveBeenCalledTimes(2);
    for (const call of (pusherServer.trigger as jest.Mock).mock.calls) {
      expect(call[0]).toBe('InfraSight');
      expect(call[1]).toBe(ALERT_EVENT_NAME);
    }
  });

  it('should send nothing when both lists are empty', async () => {
    await publishAlertEvents([], []);

    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });

  it('should swallow a Pusher failure', async () => {
    (pusherServer.trigger as jest.Mock).mockRejectedValueOnce(new Error('pusher down'));

    await expect(publishAlertEvents([fired(1)], [])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/alerting/notify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the notifier**

Create `lib/alerting/notify.ts`:

```typescript
/**
 * Real-time alert delivery.
 *
 * All alert traffic arrives on ONE Pusher event name carrying a tagged envelope.
 * PusherContext holds one callback set bound to one event name, so a subscriber
 * receiving a bare array could not tell which event produced it — the tag lives
 * in the payload rather than in a second event name.
 *
 * The payload is bounded twice, both required: Pusher caps a single event at
 * 10 KB, and this module swallows Pusher failures, so an unbounded payload would
 * mean the UI silently misses the single most dramatic event it exists to display.
 */

import { pusherServer } from '@/lib/pusher';
import { logger } from '@/lib/monitoring';
import type { AlertEvent, AlertSeverity, FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

export const ALERT_CHANNEL = 'InfraSight';
export const ALERT_EVENT_NAME = 'alert-event';

/** Above this many alerts in one evaluation, degrade to an aggregate summary. */
export const ALERT_EVENT_MAX = 20;

/**
 * Measured fallback. 20 alerts at roughly 200 bytes each is ~4 KB, inside
 * Pusher's 10 KB limit with margin — but a long rule name can blow that, so the
 * serialized body is measured before sending. Anything still over falls back to
 * the storm event rather than being split, so ordering never matters.
 */
export const ALERT_EVENT_MAX_BYTES = 8 * 1024;

type TimestampedAlert = { severity: AlertSeverity } & (
  | { fired_at: string }
  | { resolved_at: string }
);

function timestampOf(alert: TimestampedAlert): string {
  return 'fired_at' in alert ? alert.fired_at : alert.resolved_at;
}

function stormEnvelope(alerts: TimestampedAlert[]): AlertEvent {
  const by_severity: Record<AlertSeverity, number> = { info: 0, warning: 0, critical: 0 };
  for (const alert of alerts) by_severity[alert.severity]++;

  const since = alerts
    .map(timestampOf)
    .reduce((earliest, ts) => (ts < earliest ? ts : earliest), timestampOf(alerts[0]));

  return { kind: 'storm', count: alerts.length, by_severity, since };
}

function bound(envelope: AlertEvent, alerts: TimestampedAlert[]): AlertEvent {
  if (alerts.length > ALERT_EVENT_MAX) return stormEnvelope(alerts);
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > ALERT_EVENT_MAX_BYTES)
    return stormEnvelope(alerts);
  return envelope;
}

export function buildFiredEnvelope(alerts: FiredAlert[]): AlertEvent | null {
  if (alerts.length === 0) return null;
  return bound({ kind: 'fired', alerts }, alerts as unknown as TimestampedAlert[]);
}

export function buildResolvedEnvelope(alerts: ResolvedAlert[]): AlertEvent | null {
  if (alerts.length === 0) return null;
  return bound({ kind: 'resolved', alerts }, alerts as unknown as TimestampedAlert[]);
}

async function trigger(envelope: AlertEvent | null): Promise<void> {
  if (!envelope) return;

  try {
    await pusherServer.trigger(ALERT_CHANNEL, ALERT_EVENT_NAME, envelope);
  } catch (error) {
    // Never fail a committed write on a broadcast failure. Mirrors the existing
    // treatment of the Pusher trigger in the simulate route.
    logger.error('Pusher alert-event trigger failed', {
      kind: envelope.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishAlertEvents(
  fired: FiredAlert[],
  resolved: ResolvedAlert[]
): Promise<void> {
  await trigger(buildFiredEnvelope(fired));
  await trigger(buildResolvedEnvelope(resolved));
}
```

- [ ] **Step 4: Publish from the safe wrappers**

In `lib/alerting/index.ts`, import `publishAlertEvents` and call it from both wrappers. A broadcast problem must be isolated — but in **its own** `catch`, not the one wrapping the database call:

```typescript
import { publishAlertEvents } from './notify';

// safeEvaluateReadings:
try {
  const result = await evaluateReadings(readings, devices);
  try {
    await publishAlertEvents(result.fired, result.resolved);
  } catch {
    // trigger() already logs internally. This exists so a broadcast fault can
    // never discard an evaluation that was already computed and committed.
  }
  return result;
} catch (error) {
  recordAlert('evaluation_error');   // genuinely DB-only
  // ...existing logging + reportToSentry...
  return emptyEvaluationResult();
}

// safeSweepStaleAlerts: same shape, with `await publishAlertEvents([], result.resolved);`
```

**Why not one shared `try`** (which is what an earlier revision of this plan said, and what Task 13's first implementation did): the outer catch ends in `recordAlert('evaluation_error')` and `return emptyEvaluationResult()`. Sharing it means a throw anywhere in the publish path — the synchronous envelope math is the realistic surface, since `trigger()` already swallows the network call — would mislabel a **successful** evaluation as a failure and throw away a result the database has already committed. Human ruling during Task 13's review: the broadcast gets its own catch.

Update the module doc comment at the top of `lib/alerting/index.ts` too; it was written about the evaluation call only, and now describes the broadcast as well.

Pin it with a test: force `publishAlertEvents` to throw, then assert the wrapper still returns the real result and does **not** record `evaluation_error`.

Add `export { publishAlertEvents, ALERT_EVENT_NAME, ALERT_EVENT_MAX, ALERT_EVENT_MAX_BYTES } from './notify';` to the re-export block.

- [ ] **Step 5: Broadcast manual resolutions too**

A manual resolve through `PATCH /api/v2/alerts/[id]` must also reach open lists, or one admin's action leaves every other viewer's list stale until it refetches. In `app/api/v2/alerts/[id]/route.ts` (Task 10), after a successful `resolved` transition:

```typescript
import { publishAlertEvents } from '@/lib/alerting';

// ...inside handleUpdateAlert, after `if (status === 'resolved') recordAlert(...)`:
    if (status === 'resolved')
      await publishAlertEvents(
        [],
        [
          {
            _id: String(updated._id),
            rule_id: String(updated.rule_id),
            device_id: updated.device_id,
            severity: updated.severity,
            resolution: 'manual',
            resolved_at: new Date().toISOString(),
            // The Clerk USER ID, never getAuditUser's email — this payload
            // reaches every connected client, including anonymous demo visitors.
            actor: userId,
          },
        ]
      );
```

Acknowledgement is deliberately **not** broadcast: it changes no list membership (`is_open` stays true), and the acting admin already gets feedback from their own mutation's cache invalidation.

Add this assertion to `__tests__/integration/api/alerts.integration.test.ts`:

```typescript
  it('should broadcast a manual resolution with the user id, never an email', async () => {
    const spy = jest.spyOn(alerting, 'publishAlertEvents').mockResolvedValue(undefined);
    const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

    await PATCH(
      createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'resolved' }),
      { params: params(String(alert._id)) }
    );

    const [, resolvedArg] = spy.mock.calls[0];
    expect(resolvedArg[0].actor).toBe('user_test_admin');
    expect(resolvedArg[0].actor).not.toContain('@');

    spy.mockRestore();
  });
```

with `import * as alerting from '@/lib/alerting';` added to that file.

- [ ] **Step 6: Stop broadcasting readings that never persisted**

While this task owns Pusher payload correctness, close the one remaining case on the cron path. `app/api/v2/cron/simulate/route.ts` already captures the persisted subset — `const insertedReadings = await ReadingV2.bulkInsertReadings(newReadings)` — because `bulkInsertReadings` runs `insertMany({ ordered: false })` and silently skips documents that fail validation. Alert evaluation correctly uses `insertedReadings`. **The Pusher trigger still sends `newReadings`**, so a rejected reading is broadcast to every connected client as though it were stored, and the surrounding comment claiming otherwise is false.

```typescript
    // 3. Trigger Real-time Update (The "Hot" Path). Broadcast only what was
    //    actually written — a rejected reading must never appear on a client
    //    tile as though it were stored. toObject() strips the Mongoose
    //    document wrapper; versionKey: false keeps `__v` out of a payload
    //    that is already sized against Pusher's 10 KB cap.
    try {
      await pusherServer.trigger(
        'InfraSight',
        'new-readings',
        insertedReadings.map(r => r.toObject({ versionKey: false }))
      );
    } catch (pusherError) {
      logger.error('Pusher trigger failed after successful DB write', {
        error: pusherError instanceof Error ? pusherError.message : String(pusherError),
        readingsCount: insertedReadings.length,
      });
    }
```

Note `readingsCount` moves to `insertedReadings.length` too — the old value overstated what the failed broadcast would have carried.

Add a case to the cron route's existing integration test asserting that a batch with one rejected reading broadcasts `insertedReadings.length` rows, not `newReadings.length`. Drive the rejection through `bulkInsertReadings` rather than mocking the trigger's argument, or the test proves nothing about the wiring.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test __tests__/unit/lib/alerting __tests__/integration/api`
Expected: PASS. The existing evaluate and sweep suites must stay green — `publishAlertEvents` is only called from the wrappers, not from `evaluateReadings` itself.

Then: `npx tsc --noEmit && pnpm lint` — 0 errors, 0 problems.

- [ ] **Step 8: Commit**

Two commits; the cron payload fix is unrelated to alert delivery and should not be buried in it:

```bash
git add lib/alerting/notify.ts lib/alerting/index.ts app/api/v2/alerts/[id]/route.ts __tests__/unit/lib/alerting/notify.test.ts __tests__/integration/api/alerts.integration.test.ts
git commit -m "feat(alerting): broadcast bounded alert events over Pusher"

git add app/api/v2/cron/simulate/route.ts __tests__/integration/api
git commit -m "fix(cron): broadcast only the readings that persisted"
```

---

### Task 14: Client subscription and toasts

The existing `InfraSight` channel gains one event rather than a second channel being created. `PusherProvider` already owns exactly one subscription and multiplexes callbacks to subscribers, so adding an event keeps subscription teardown in the one place that already handles it correctly — which satisfies #100's "subscriptions clean up on unmount" by construction.

**Files:**
- Modify: `types/v2/alert.types.ts` (add `of` to the `storm` variant, Step 0)
- Modify: `lib/alerting/notify.ts` (set `of`, Step 0)
- Modify: `lib/alerting/index.ts` (give the nested broadcast catches observability, Step 0)
- Modify: `__tests__/unit/lib/alerting/notify.test.ts` (assert `of` on both storm paths, Step 0)
- Modify: `lib/pusher-context.tsx`
- Create: `components/alerts/AlertToaster.tsx`
- Test: `__tests__/unit/lib/pusher-alerts.test.tsx`
- Test: `__tests__/unit/components/AlertToaster.test.tsx`

**Only `fired` raises a toast.** `resolved` is broadcast so open lists reconcile without a refetch, but raises no popup — nobody wants one per device when a floor-wide condition clears. This structurally satisfies #100's "notifications do not fire for a viewer's own acknowledge and resolve actions": firing is always system-generated, so no viewer can ever cause a toast. The acting admin gets feedback from their own mutation's optimistic update instead.

- [ ] **Step 0: Make the `storm` envelope say which direction it is**

`AlertEvent`'s `storm` variant (`types/v2/alert.types.ts`) is `{ kind: 'storm', count, by_severity, since }` — with **nothing distinguishing a storm of alerts firing from a storm of alerts clearing**. `publishAlertEvents` bounds `fired` and `resolved` independently, and a floor-wide condition clearing is exactly the case that overflows the resolved list, so resolved storms are not hypothetical. The consumer cannot tell them apart, and the toast copy below (`${event.count} alerts firing`) would announce a mass *recovery* as a mass *outage* — the most alarming message in the app, fired on the best possible news.

Found during Task 13's review; the type predates that task and its code matched the type exactly, so it lands here, on the first consumer that has to branch on it.

Add the discriminator to the wire type:

```typescript
  | {
      kind: 'storm';
      /** Which direction this storm is: alerts opening, or alerts clearing. */
      of: 'fired' | 'resolved';
      count: number;
      by_severity: Record<AlertSeverity, number>;
      since: string;
    };
```

Then set it in `lib/alerting/notify.ts` — `stormEnvelope()` takes the direction from its caller, so `buildFiredEnvelope` passes `'fired'` and `buildResolvedEnvelope` passes `'resolved'`. Extend that file's existing storm tests to assert `of` on both paths; a storm test that does not check `of` cannot tell the two apart either.

`types/v2/alert.types.ts` must keep its zero imports — it is loaded by client components.

**While you are in `lib/alerting/`, give the two nested broadcast catches a voice.** Task 13's fix round added `catch { }` blocks around `publishAlertEvents` in both `safe*` wrappers (`lib/alerting/index.ts`, in `safeEvaluateReadings` and `safeSweepStaleAlerts`) so a broadcast fault cannot discard a committed result. Correct — but they are comment-only, so they swallow with **zero** observability. `trigger()` in `notify.ts` wraps only the `pusherServer.trigger()` call, so a throw from the synchronous envelope math (`buildFiredEnvelope` / `buildResolvedEnvelope`, which run before `trigger()` is reached) now produces no log line, no Sentry event, and no metric. Before that fix it at least reached the outer catch and was logged — mislabelled, which was the bug, but visible.

An empty catch in the alerting subsystem is the same shape as the Critical the backend review already fixed once ("the alerting failure signal is unreachable in production"). Do not leave a second one. Log and report, but still do not rethrow:

```typescript
  } catch (error) {
    // Never let a broadcast fault discard an evaluation the DB already
    // committed — but never let it vanish silently either.
    logger.error('Alert broadcast failed after a committed write', {
      error: error instanceof Error ? error.message : String(error),
    });
    reportToSentry(error);
  }
```

`reportToSentry` is already defined in that file and is itself guarded against throwing. Add a test asserting the failure is reported — the existing isolation tests only assert that the result survives, which passes just as well against an empty catch.



**Interfaces:**
- Consumes: `AlertEvent` from `@/types/v2/alert.types` (Task 3); `queryKeys` (Task 12).
- Produces:
  - `subscribeAlerts(cb: AlertsCallback)` / `unsubscribeAlerts(cb)` on `PusherContextValue`
  - `export function usePusherAlerts(callback: (event: AlertEvent) => void): void`
  - `export function AlertToaster(): null` — mount-once component that raises toasts and reconciles the React Query cache

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/pusher-alerts.test.tsx` (jsdom project — note the `.tsx` extension):

```typescript
/**
 * usePusherAlerts Tests
 */

import { render, act } from '@testing-library/react';
import React from 'react';
import { PusherProvider, usePusherAlerts } from '@/lib/pusher-context';
import { getPusherClient } from '@/lib/pusher-client';
import type { AlertEvent } from '@/types/v2/alert.types';

const handlers = new Map<string, (data: unknown) => void>();
const unbind = jest.fn();
const unsubscribe = jest.fn();

jest.mock('@/lib/pusher-client', () => ({
  getPusherClient: jest.fn(() => ({
    subscribe: jest.fn(() => ({
      bind: (event: string, handler: (data: unknown) => void) => {
        handlers.set(event, handler);
      },
      unbind: (event: string) => {
        unbind(event);
        handlers.delete(event);
      },
    })),
    unsubscribe,
  })),
}));

function Consumer({ onEvent }: { onEvent: (e: AlertEvent) => void }) {
  usePusherAlerts(onEvent);
  return null;
}

beforeEach(() => {
  handlers.clear();
  unbind.mockClear();
  unsubscribe.mockClear();
  (getPusherClient as jest.Mock).mockClear();
});

describe('usePusherAlerts', () => {
  it('should bind the alert-event name', () => {
    render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    expect(handlers.has('alert-event')).toBe(true);
  });

  it('should deliver a fired envelope to subscribers', () => {
    const onEvent = jest.fn();
    render(
      <PusherProvider>
        <Consumer onEvent={onEvent} />
      </PusherProvider>
    );

    const envelope: AlertEvent = { kind: 'fired', alerts: [] };
    act(() => handlers.get('alert-event')!(envelope));

    expect(onEvent).toHaveBeenCalledWith(envelope);
  });

  it('should deliver a storm envelope', () => {
    const onEvent = jest.fn();
    render(
      <PusherProvider>
        <Consumer onEvent={onEvent} />
      </PusherProvider>
    );

    const envelope: AlertEvent = {
      kind: 'storm',
      of: 'fired', // required as of Step 0 — omitting it fails `tsc --noEmit`
      count: 312,
      by_severity: { info: 0, warning: 12, critical: 300 },
      since: '2026-08-01T12:00:00.000Z',
    };
    act(() => handlers.get('alert-event')!(envelope));

    expect(onEvent).toHaveBeenCalledWith(envelope);
  });

  it('should not break the readings subscription', () => {
    render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    expect(handlers.has('new-readings')).toBe(true);
  });

  it('should unbind both events on unmount', () => {
    const { unmount } = render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    unmount();

    expect(unbind).toHaveBeenCalledWith('alert-event');
    expect(unbind).toHaveBeenCalledWith('new-readings');
    expect(unsubscribe).toHaveBeenCalledWith('InfraSight');
  });

  it('should stop delivering after a subscriber unmounts', () => {
    const onEvent = jest.fn();
    function Toggle({ show }: { show: boolean }) {
      return (
        <PusherProvider>{show ? <Consumer onEvent={onEvent} /> : null}</PusherProvider>
      );
    }

    const { rerender } = render(<Toggle show />);
    rerender(<Toggle show={false} />);

    act(() => handlers.get('alert-event')?.({ kind: 'fired', alerts: [] }));

    expect(onEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/pusher-alerts.test.tsx`
Expected: FAIL — `usePusherAlerts` is not exported.

- [ ] **Step 3: Extend the Pusher context**

In `lib/pusher-context.tsx`:

```typescript
import type { AlertEvent } from '@/types/v2/alert.types';

type AlertsCallback = (event: AlertEvent) => void;

interface PusherContextValue {
  subscribe: (cb: ReadingsCallback) => void;
  unsubscribe: (cb: ReadingsCallback) => void;
  /** Register a callback that fires for every alert envelope. */
  subscribeAlerts: (cb: AlertsCallback) => void;
  unsubscribeAlerts: (cb: AlertsCallback) => void;
}
```

Inside `PusherProvider`, add a second callback set and bind the new event on the same channel:

```typescript
  const alertCallbacksRef = useRef<Set<AlertsCallback>>(new Set());
```

```typescript
    const alertHandler = (event: AlertEvent) => {
      alertCallbacksRef.current.forEach(cb => {
        try {
          cb(event);
        } catch (err) {
          console.error('PusherProvider: error in alert subscriber callback', err);
        }
      });
    };

    channel.bind('new-readings', handler);
    channel.bind('alert-event', alertHandler);

    return () => {
      channel.unbind('new-readings', handler);
      channel.unbind('alert-event', alertHandler);
      pusher.unsubscribe('InfraSight');
    };
```

Add the two memoized registration functions and include them in the provider value, then export the hook:

```typescript
  const subscribeAlerts = useCallback((cb: AlertsCallback) => {
    alertCallbacksRef.current.add(cb);
  }, []);

  const unsubscribeAlerts = useCallback((cb: AlertsCallback) => {
    alertCallbacksRef.current.delete(cb);
  }, []);
```

```typescript
/**
 * Hook for components that need to react to real-time alert envelopes.
 *
 * The callback is held in a ref so a caller that does not memoize will not cause
 * a re-subscribe on every render. The ref is refreshed in a commit-phase effect
 * rather than assigned during render: assigning during render violates
 * react-hooks/refs, and Pusher handlers only ever read the ref asynchronously,
 * long after commit.
 */
export function usePusherAlerts(callback: AlertsCallback): void {
  const ctx = useContext(PusherContext);

  const callbackRef = useRef<AlertsCallback>(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!ctx) {
      console.warn(
        'usePusherAlerts: PusherProvider is not in the component tree. Real-time alerts are disabled.'
      );
      return;
    }

    const stableCallback: AlertsCallback = event => {
      callbackRef.current(event);
    };

    ctx.subscribeAlerts(stableCallback);
    return () => {
      ctx.unsubscribeAlerts(stableCallback);
    };
  }, [ctx]);
}
```

Also export the `AlertsCallback` type.

**Do NOT modify the existing `usePusherReadings` — it already has this shape.** An earlier draft of this plan told you to fix it here, because it used to assign the ref during render and that was one of the repo's baseline lint problems (`lib/pusher-context.tsx | react-hooks/refs`). `main`'s b43468d already fixed it. As of this branch, `lib/pusher-context.tsx:105-109` reads:

```typescript
  const callbackRef = useRef<ReadingsCallback>(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
```

So the human ruling that both hooks must be lint-clean is already satisfied for the readings hook. **Copy that shape verbatim for `usePusherAlerts`, including the `[callback]` dependency array** — the code block above for `usePusherAlerts` omits the array, which also lints clean but makes the two sibling hooks gratuitously different. Match the file. `pnpm lint` must report **0** problems afterwards.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/pusher-alerts.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the toaster**

Create `components/alerts/AlertToaster.tsx`:

```typescript
'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { usePusherAlerts } from '@/lib/pusher-context';
import { queryKeys } from '@/lib/query/queryClient';
import type { AlertEvent, AlertSeverity } from '@/types/v2';

const TOAST_TYPE: Record<AlertSeverity, 'error' | 'warning' | 'info'> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

/**
 * Raises toasts for alerts that start firing and keeps the cached alert list in
 * step with what the server just did. Renders nothing.
 *
 * Only `fired` raises a toast. `resolved` is broadcast so open lists reconcile
 * without a refetch, but a popup per device when a floor-wide condition clears
 * is noise. Because firing is always system-generated, no viewer can ever cause a
 * toast with their own acknowledge or resolve — the acting admin gets feedback
 * from their own mutation instead.
 */
export function AlertToaster() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleEvent = useCallback(
    (event: AlertEvent) => {
      switch (event.kind) {
        case 'fired':
          for (const alert of event.alerts)
            toast[TOAST_TYPE[alert.severity]](
              `${alert.rule_name} — ${alert.device_id} (${alert.trigger_value})`,
              { onClick: () => router.push(`/alerts/${alert._id}`) }
            );
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;

        case 'resolved':
          // No toast: reconcile silently.
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;

        case 'storm':
          // The storm envelope deliberately carries no rows, so there is nothing
          // to patch — invalidate and let the list refetch.
          //
          // Only a FIRED storm toasts. A resolved storm is a mass recovery, and
          // announcing it with the same red banner would report the best news in
          // the app as the worst. It still invalidates, so lists reconcile.
          if (event.of === 'fired')
            toast.error(`${event.count} alerts firing`, {
              onClick: () => router.push('/alerts'),
            });
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;
      }
    },
    [queryClient, router]
  );

  usePusherAlerts(handleEvent);

  return null;
}

export default AlertToaster;
```

- [ ] **Step 5b: Test the toaster's branching**

`AlertToaster` decides which events become popups and which reconcile silently. That decision is the whole component; it needs its own test. Create `__tests__/unit/components/AlertToaster.test.tsx`, mocking `react-toastify`, `next/navigation`, and `usePusherAlerts` so you can hand the component an envelope directly:

Cover, at minimum:

| Envelope | Expected |
| --- | --- |
| `{ kind: 'fired', alerts: [critical, info] }` | `toast.error` once **and** `toast.info` once — severity maps to toast type |
| `{ kind: 'resolved', alerts: [...] }` | **no toast at all**, but `invalidateQueries` still called |
| `{ kind: 'storm', of: 'fired', count: 312 }` | one `toast.error` mentioning 312 |
| `{ kind: 'storm', of: 'resolved', count: 312 }` | **no toast**, `invalidateQueries` still called |

The last two rows are the point: assert both that the fired storm toasts *and* that the resolved storm does not. A test that only checks the fired case passes just as happily against a component that toasts unconditionally.

Assert `invalidateQueries` fires on **every** branch — that is what keeps open lists and the nav badge honest, and it is easy to lose when adding an early return for the silent cases.

- [ ] **Step 6: Mount the toaster**

Render `<AlertToaster />` once, inside the same provider tree that already hosts `PusherProvider` and the React Query provider in `app/layout.tsx`. Confirm `react-toastify`'s `<ToastContainer />` is already mounted there; if it is not, add it alongside.

- [ ] **Step 7: Verify the app builds**

Run: `npx tsc --noEmit && pnpm build`
Expected: clean build. A failure mentioning `mongoose` inside a client component means `types/v2/alert.types.ts` picked up a server-only import — it must stay dependency-free.

- [ ] **Step 8: Commit**

```bash
git add types/v2/alert.types.ts lib/alerting/notify.ts lib/alerting/index.ts __tests__/unit/lib/alerting/notify.test.ts __tests__/unit/lib/alerting/sweep.test.ts
git commit -m "feat(alerting): tag storm envelopes with their direction"

git add lib/pusher-context.tsx components/alerts/AlertToaster.tsx app/layout.tsx __tests__/unit/lib/pusher-alerts.test.tsx __tests__/unit/components/AlertToaster.test.tsx
git commit -m "feat(alerting): subscribe to alert events and toast on fire"
```

---

### Task 15: Alert badges and list

**Files:**
- Create: `components/alerts/AlertSeverityBadge.tsx`
- Create: `components/alerts/AlertStatusBadge.tsx`
- Create: `components/alerts/useAlertFilterParams.ts`
- Create: `components/alerts/AlertList.tsx`
- Create: `app/alerts/page.tsx`
- Test: `__tests__/unit/components/AlertBadges.test.tsx`
- Test: `__tests__/unit/components/useAlertFilterParams.test.tsx`

Badges mirror `components/ScheduleStatusBadge.tsx` exactly: a `Record<T, { label, className, icon }>` config object, `Badge variant="outline"`, `cn()` for class merging, and light/dark class pairs. `AlertList` is modelled on `components/ScheduleList.tsx` — same `Card` shell, same `Select` filters, same `PAGE_SIZE = 10` pagination, same `useAdminAction()` gating.

**Interfaces:**
- Consumes: `useAlertsList`, `useAcknowledgeAlert`, `useResolveAlert` (Task 12); `AlertV2Response`, `AlertStatus`, `AlertSeverity` (Task 3); `useAdminAction` from `@/lib/auth/rbac-client`.
- Produces:
  - `export function AlertSeverityBadge({ severity, className?, showIcon? })`
  - `export function AlertStatusBadge({ status, className?, showIcon? })`
  - `export function AlertList({ initialFilters?, showHeader?, onDeviceClick? })`
  - Default-exported `AlertsPage` at `/alerts`

- [ ] **Step 1: Write the failing badge test**

Create `__tests__/unit/components/AlertBadges.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { AlertSeverityBadge } from '@/components/alerts/AlertSeverityBadge';
import { AlertStatusBadge } from '@/components/alerts/AlertStatusBadge';

describe('AlertSeverityBadge', () => {
  it.each(['info', 'warning', 'critical'] as const)('should render %s', severity => {
    render(<AlertSeverityBadge severity={severity} />);
    expect(screen.getByText(new RegExp(severity, 'i'))).toBeInTheDocument();
  });

  it('should hide the icon when showIcon is false', () => {
    const { container } = render(<AlertSeverityBadge severity="critical" showIcon={false} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('AlertStatusBadge', () => {
  it.each([
    ['firing', /firing/i],
    ['acknowledged', /acknowledged/i],
    ['resolved', /resolved/i],
    ['pending', /pending/i],
  ] as const)('should render %s', (status, pattern) => {
    render(<AlertStatusBadge status={status} />);
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/components/AlertBadges.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the badges**

Create `components/alerts/AlertSeverityBadge.tsx`, following `components/ScheduleStatusBadge.tsx` line for line:

```typescript
'use client';

import { Badge } from '@/components/ui/badge';
import { Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import type { AlertSeverity } from '@/types/v2';
import { cn } from '@/lib/utils';

interface AlertSeverityBadgeProps {
  severity: AlertSeverity;
  className?: string;
  showIcon?: boolean;
}

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { label: string; className: string; icon: typeof Info }
> = {
  info: {
    label: 'Info',
    className:
      'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    icon: Info,
  },
  warning: {
    label: 'Warning',
    className:
      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    className:
      'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    icon: AlertOctagon,
  },
};

export function AlertSeverityBadge({
  severity,
  className,
  showIcon = true,
}: AlertSeverityBadgeProps) {
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

export default AlertSeverityBadge;
```

Create `components/alerts/AlertStatusBadge.tsx` with the same structure over `AlertStatus`: `pending` → `Clock`, neutral gray; `firing` → `Zap`, red; `acknowledged` → `Eye`, amber; `resolved` → `CheckCircle`, green.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/components/AlertBadges.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the list component**

Create `components/alerts/AlertList.tsx`, copying the structure of `components/ScheduleList.tsx`:

- `'use client'`; props `{ initialFilters?: Partial<ListAlertsQueryParams>; showHeader?: boolean; onDeviceClick?: (deviceId: string) => void }`
- `const ackAction = useAdminAction();` and `const resolveAction = useAdminAction();`
- `STATUS_OPTIONS = [{ value: 'open', label: 'Open' }, { value: 'firing', … }, { value: 'acknowledged', … }, { value: 'resolved', label: 'Resolved (history)' }]` and `SEVERITY_OPTIONS` with an `all` entry, rendered through `Select`
- `PAGE_SIZE = 10`; page state; `useAlertsList({ ...filters, page, limit: PAGE_SIZE })`
- Each row: `AlertSeverityBadge`, `AlertStatusBadge`, rule name, a `Link` to `/alerts/${alert._id}`, the device id as a button calling `onDeviceClick`, the condition in plain language, and **a relative timestamp** off `fired_at` (falling back to `breached_since`). There is no relative-time helper in this repo and no `date-fns` dependency — `ScheduleList.tsx:137` formats absolute dates with `toLocaleDateString`. Write a small local `relativeTime()` helper rather than adding a dependency, and test it, including the `fired_at`-absent fallback
- Acknowledge / Resolve buttons render for every viewer but are `disabled={!isAdmin}` with a `title` tooltip explaining why — **disabled, not hidden**, per the demo-mode rule, so a visitor learns the workflow exists. Server-side `requireAdmin()` is the real enforcement
- On mutation success, `toast.success(...)`; on error, `toast.error(err.message)`
- Loading state reuses the spinner markup from `ScheduleList`; empty state reads "No open alerts."

Concretely:

```typescript
'use client';

import Link from 'next/link';
import { toast } from 'react-toastify';
import { CheckCircle, Eye, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import { AlertStatusBadge } from './AlertStatusBadge';
import { useAlertFilterParams } from './useAlertFilterParams';
import { useAlertsList, useAcknowledgeAlert, useResolveAlert } from '@/lib/query/hooks';
import { useAdminAction } from '@/lib/auth/rbac-client';
import type {
  AlertComparison,
  AlertSeverity,
  AlertStatus,
  AlertV2Response,
  ListAlertsQueryParams,
} from '@/types/v2';

interface AlertListProps {
  initialFilters?: Partial<ListAlertsQueryParams>;
  showHeader?: boolean;
  onDeviceClick?: (deviceId: string) => void;
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'firing', label: 'Firing' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved (history)' },
];

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const PAGE_SIZE = 10;

const COMPARISON_WORDS: Record<AlertComparison, string> = {
  gt: 'above',
  gte: 'at or above',
  lt: 'below',
  lte: 'at or below',
};

/** "temperature above 30" / "battery_level below 20" — shared with AlertDetailView. */
export function describeCondition(
  alert: Pick<AlertV2Response, 'metric' | 'comparison' | 'threshold'>
): string {
  return `${alert.metric} ${COMPARISON_WORDS[alert.comparison]} ${alert.threshold}`;
}

export function AlertList({ initialFilters = {}, showHeader = true, onDeviceClick }: AlertListProps) {
  const ackAction = useAdminAction();
  const resolveAction = useAdminAction();
  // URL is the source of truth — see useAlertFilterParams below.
  const { status, setStatus, severity, setSeverity, page, setPage } =
    useAlertFilterParams(initialFilters);

  const filters: ListAlertsQueryParams = {
    ...initialFilters,
    // 'open' is the server default (firing + acknowledged), so it is sent as absent.
    ...(status !== 'open' ? { status: status as AlertStatus } : {}),
    ...(severity !== 'all' ? { severity: severity as AlertSeverity } : {}),
    page,
    limit: PAGE_SIZE,
  };

  const { data: alerts, isLoading, error, refetch } = useAlertsList(filters);
  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();

  const act = (
    mutation: typeof acknowledge,
    id: string,
    successMessage: string
  ) =>
    mutation.mutate(
      { id },
      {
        onSuccess: () => toast.success(successMessage),
        onError: (err: Error) => toast.error(err.message),
      }
    );

  return (
    <Card>
      {showHeader && (
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Alerts</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              label="Status"
              value={status}
              onValueChange={setStatus}
              options={STATUS_OPTIONS}
              size="sm"
            />
            <Select
              label="Severity"
              value={severity}
              onValueChange={setSeverity}
              options={SEVERITY_OPTIONS}
              size="sm"
            />
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
      )}

      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {error && !isLoading && (
          <p className="py-8 text-center text-sm text-destructive">Failed to load alerts</p>
        )}

        {!isLoading && !error && alerts?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No open alerts.</p>
        )}

        <ul className="divide-y divide-border">
          {alerts?.map(alert => (
            <li key={alert._id} className="flex flex-wrap items-center gap-3 py-3">
              <AlertSeverityBadge severity={alert.severity} />
              <AlertStatusBadge status={alert.status} />

              <Link href={`/alerts/${alert._id}`} className="font-medium hover:underline">
                {alert.rule_name}
              </Link>

              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => onDeviceClick?.(alert.device_id)}
              >
                {alert.device_id}
              </button>

              <span className="text-sm text-muted-foreground">
                {describeCondition(alert)} — last {alert.last_value}
              </span>

              {/* "How long has this been firing" is core triage information on an
                  alerting dashboard, not decoration. */}
              <span className="text-sm text-muted-foreground">
                {relativeTime(alert.fired_at ?? alert.breached_since)}
              </span>

              <div className="ml-auto flex items-center gap-2">
                {/* useAdminAction(): an admin gets an enabled control; a visitor on the
                    demo deployment gets it disabled with a tooltip, so they can see the
                    workflow exists; a non-admin elsewhere gets it hidden, matching every
                    other screen. requireAdmin() server-side is the real enforcement. */}
                {ackAction.visible && alert.status === 'firing' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={ackAction.disabled || acknowledge.isPending}
                    title={ackAction.tooltip}
                    onClick={() => act(acknowledge, alert._id, 'Alert acknowledged')}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Acknowledge
                  </Button>
                )}
                {resolveAction.visible && alert.is_open && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resolveAction.disabled || resolve.isPending}
                    title={resolveAction.tooltip}
                    onClick={() => act(resolve, alert._id, 'Alert resolved')}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Resolve
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between">
          {/* Visible text, not bare chevrons — these need an accessible name, and
              ScheduleList.tsx:337-353 (the model for this component) labels them. */}
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={(alerts?.length ?? 0) < PAGE_SIZE}
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default AlertList;
```

`Select`'s prop contract has been verified against `components/ui/select.tsx` and is used above exactly as `components/ScheduleList.tsx:183-200` uses it: `{ value, onValueChange: (value: string) => void, options: SelectOption[], label?, size?: 'sm' | 'md' }`. It is **not** a native `<select>` — there is no `onChange`, no `event.target.value`, and no `aria-label` prop. Use `label` for the accessible name.

**Write `components/alerts/useAlertFilterParams.ts` first.** Modelled on `app/devices/_components/useDeviceFilterParams.ts`, which is the repo's precedent and whose central rule applies here too: **the URL is the single source of truth**, and nothing writes derived state back into it, so there is no round-trip loop. This is what makes `/alerts?status=resolved` a shareable link and browser Back step through filter changes.

```typescript
export interface AlertFilterParams {
  status: string;   // 'open' (default) | 'firing' | 'acknowledged' | 'resolved'
  severity: string; // 'all' (default) | 'critical' | 'warning' | 'info'
  page: number;     // 1-based
  setStatus: (value: string) => void;
  setSeverity: (value: string) => void;
  setPage: (page: number) => void;
}

export function useAlertFilterParams(
  initialFilters?: Partial<ListAlertsQueryParams>
): AlertFilterParams;
```

Three rules the tests must pin:

1. **`setStatus` and `setSeverity` reset `page` to 1 in the same URL write.** Two sequential writes would race and leave a junk history entry — and land the user on page 4 of a two-page result.
2. **Default values are omitted from the query string**, so `/alerts` stays clean: no `status=open`, no `severity=all`, no `page=1`. This mirrors `buildQueryString` in the devices hook.
3. **Unparseable values fall back to the default** rather than reaching the API — `?page=banana` is page 1, `?severity=purple` is `all`.

`initialFilters` seeds only what the URL does not already specify; an explicit URL parameter always wins, or a shared link would not survive the first render.

- [ ] **Step 6: Write the alerts page**

Create `app/alerts/page.tsx`:

```typescript
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertList } from '@/components/alerts/AlertList';

/**
 * Active alerts. History is a filter value on the same page rather than a
 * separate route (`/alerts?status=resolved`), following the Phase 3 URL-sync
 * precedent in app/devices/_components/useDeviceFilterParams.ts.
 */
export default function AlertsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Alerts</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/alerts/rules">
            <SlidersHorizontal className="h-4 w-4 mr-2" />
            Manage rules
          </Link>
        </Button>
      </header>

      <AlertList onDeviceClick={deviceId => router.push(`/devices/${deviceId}`)} />
    </div>
  );
}
```

URL syncing is already handled by `useAlertFilterParams` from Step 5 — there is nothing extra to do here. `app/alerts/page.tsx` stays a thin shell.

Because `AlertList` calls `useSearchParams()`, Next.js requires it to sit under a Suspense boundary or the build fails with a prerender error on `/alerts`. Wrap it: `<Suspense fallback={…}><AlertList … /></Suspense>`. Check how `app/devices/page.tsx` handles the same constraint and follow it.

- [ ] **Step 7: Verify build and tests**

Run: `npx tsc --noEmit && pnpm test __tests__/unit/components && pnpm build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add components/alerts app/alerts/page.tsx __tests__/unit/components/AlertBadges.test.tsx __tests__/unit/components/useAlertFilterParams.test.tsx
git commit -m "feat(alerting): add alert badges, list, and /alerts page"
```

---

### Task 16: Alert detail page

**Files:**
- Create: `components/alerts/AlertDetailView.tsx`
- Create: `app/alerts/[id]/page.tsx`
- Test: `__tests__/unit/components/AlertDetailView.test.tsx`

**No new endpoint is added for the bracketing readings.** The page issues a second call to the existing `GET /api/v2/readings?device_id=<id>&startDate=<fired_at − 15m>&endDate=<fired_at + 15m>`, which already satisfies that endpoint's required-time-range constraint. `getAlertQuerySchema` therefore stays at `include_device` only.

**Pass `limit` and the sort explicitly — the defaults are wrong for this view.** `paginationSchema` (`lib/validations/common.validation.ts:48-51`) defaults `limit` to **20**, and `app/api/v2/readings/route.ts:104-105` defaults to `timestamp` **descending**. Left implicit, a ±15-minute window silently caps at the 20 *most recent* readings, newest-first — dropping exactly the early part of the window that shows the breach developing, which is the only reason the table exists. It fails by rendering a plausible partial table, not by erroring.

```typescript
v2Api.readings.list({
  device_id: alert.device_id,
  startDate: range.start,
  endDate: range.end,
  limit: 100,                 // endpoint maximum; covers 30 min at any real cadence
  sortBy: 'timestamp',
  sortDirection: 'asc',       // oldest first — breach develops downward
})
```

Test the query itself, not just the presentation. Assert the params actually handed to `v2Api.readings.list` (including `limit` and the sort), that the window is centred on `fired_at`, and that it falls back to `breached_since` when `fired_at` is absent. Mocking `useQuery` wholesale hides all of this — mock `v2Api` instead.

`AlertDetailView` is modelled on `components/devices/DeviceDetailView.tsx`: a presentational component shared between the page and any future drawer, taking already-loaded data as props. `app/alerts/[id]/page.tsx` follows `app/devices/[id]/page.tsx`: a canonical URL that survives a refresh and can be pasted into a chat mid-incident, calling `notFound()` for ids that do not resolve.

**Interfaces:**
- Consumes: `useAlertDetail` (Task 12); `v2Api.readings.list`; `useAcknowledgeAlert`, `useResolveAlert`; `describeCondition` from `components/alerts/AlertList` (Task 15); badges (Task 15).
- Produces:
  - `export function AlertDetailView({ alert, bracketingReadings, loading })`
  - Default-exported `AlertDetailPage` at `/alerts/[id]`

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/components/AlertDetailView.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { AlertDetailView } from '@/components/alerts/AlertDetailView';
import type { AlertV2Response } from '@/types/v2';

function alert(overrides: Partial<AlertV2Response> = {}): AlertV2Response {
  return {
    _id: '507f1f77bcf86cd799439011',
    rule_id: '507f1f77bcf86cd799439012',
    rule_name: 'High temperature',
    device_id: 'device_001',
    status: 'firing',
    is_open: true,
    severity: 'critical',
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    trigger_value: 42,
    last_value: 41,
    breached_since: '2026-08-01T12:00:00.000Z',
    last_observed_at: '2026-08-01T12:10:00.000Z',
    fired_at: '2026-08-01T12:05:00.000Z',
    audit: {
      created_at: '2026-08-01T12:00:00.000Z',
      created_by: 'system',
      updated_at: '2026-08-01T12:10:00.000Z',
      updated_by: 'system',
    },
    ...overrides,
  };
}

jest.mock('@/lib/auth/rbac-client', () => ({
  useAdminAction: () => ({ visible: true, disabled: false }),
  useRbac: () => ({ isAdmin: true, isMember: false, orgRole: 'org:admin', isLoaded: true }),
}));

describe('AlertDetailView', () => {
  it('should state the condition in plain language', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByText(/above 30/i)).toBeInTheDocument();
  });

  it('should mention the duration when the rule has one', () => {
    render(
      <AlertDetailView
        alert={alert()}
        bracketingReadings={[]}
        loading={false}
        forDurationSeconds={300}
      />
    );

    expect(screen.getByText(/for 5 minutes/i)).toBeInTheDocument();
  });

  it('should render the lifecycle timeline', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByText(/breached since/i)).toBeInTheDocument();
    expect(screen.getByText(/fired/i)).toBeInTheDocument();
  });

  it('should show acknowledged and resolved steps once they exist', () => {
    render(
      <AlertDetailView
        alert={alert({
          status: 'resolved',
          is_open: false,
          audit: {
            created_at: '2026-08-01T12:00:00.000Z',
            created_by: 'system',
            updated_at: '2026-08-01T12:40:00.000Z',
            updated_by: 'user_1',
            acknowledged_at: '2026-08-01T12:20:00.000Z',
            acknowledged_by: 'user_1',
            resolved_at: '2026-08-01T12:40:00.000Z',
            resolved_by: 'user_1',
            resolution: 'manual',
          },
        })}
        bracketingReadings={[]}
        loading={false}
      />
    );

    expect(screen.getByText(/acknowledged/i)).toBeInTheDocument();
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
  });

  it('should link to the device', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByRole('link', { name: /device_001/i })).toHaveAttribute(
      'href',
      '/devices/device_001'
    );
  });

  it('should render the bracketing readings', () => {
    render(
      <AlertDetailView
        alert={alert()}
        bracketingReadings={[
          { timestamp: '2026-08-01T12:04:00.000Z', value: 29 },
          { timestamp: '2026-08-01T12:05:00.000Z', value: 42 },
        ]}
        loading={false}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/components/AlertDetailView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the detail view**

Create `components/alerts/AlertDetailView.tsx`:

- `'use client'`; props `{ alert: AlertV2Response; bracketingReadings: Array<{ timestamp: string; value: number }>; loading: boolean; forDurationSeconds?: number }`
- Header: rule name, `AlertSeverityBadge`, `AlertStatusBadge`
- **Condition in plain language**: `describeCondition(alert)` plus, when `forDurationSeconds` is supplied and non-zero, ` for ${humanizeDuration(forDurationSeconds)}` — producing e.g. "temperature above 30 for 5 minutes"
- **Timeline** across `breached_since → fired_at → audit.acknowledged_at → audit.resolved_at`, each step rendered only when the timestamp exists, with the actor beside acknowledged/resolved and `audit.resolution` beside resolved (so `stale` and `device_inactive` read distinctly from `auto`, and history never claims a problem was fixed when the sensor merely went quiet)
- Values block: `trigger_value`, `last_value`, `resolved_value`, `threshold`
- `<Link href={`/devices/${alert.device_id}`}>` for the device
- Bracketing readings as a simple table, `fired_at ± 15m`
- Acknowledge / Resolve buttons via `useAdminAction()` — see Task 15; do not hand-roll with `useRbac`

Add a small local helper:

```typescript
function humanizeDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
```

- [ ] **Step 4: Write the detail page**

Create `app/alerts/[id]/page.tsx`, following `app/devices/[id]/page.tsx`:

```typescript
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDetailView } from '@/components/alerts/AlertDetailView';
import { useAlertDetail } from '@/lib/query/hooks';
import { v2Api } from '@/lib/api/v2-client';
import { queryKeys } from '@/lib/query/queryClient';

const BRACKET_MINUTES = 15;

/**
 * Canonical, deep-linkable alert page: it survives a refresh and can be pasted
 * into a chat mid-incident.
 */
export default function AlertDetailPage() {
  const params = useParams<{ id: string }>();
  const alertId = params?.id ? decodeURIComponent(params.id) : '';

  const { data: alert, isLoading, error } = useAlertDetail(alertId, { include_device: true });

  const range = useMemo(() => {
    const anchor = alert?.fired_at ?? alert?.breached_since;
    if (!anchor) return null;
    const at = new Date(anchor).getTime();
    return {
      startDate: new Date(at - BRACKET_MINUTES * 60_000).toISOString(),
      endDate: new Date(at + BRACKET_MINUTES * 60_000).toISOString(),
    };
  }, [alert?.fired_at, alert?.breached_since]);

  // No new endpoint: the existing readings endpoint already requires a time
  // range, and fired_at +/- 15 minutes satisfies it.
  const { data: bracketingReadings = [] } = useQuery({
    queryKey: queryKeys.readings.list({ device_id: alert?.device_id, ...range }),
    queryFn: async () => {
      const response = await v2Api.readings.list({
        device_id: alert!.device_id,
        startDate: range!.startDate,
        endDate: range!.endDate,
      });
      return response.data;
    },
    enabled: !!alert?.device_id && !!range,
  });

  // Renders the styled app-wide 404 for ids that do not resolve.
  if (!isLoading && !alert && error) notFound();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6 space-y-4">
        <Link
          href="/alerts"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to alerts
        </Link>
        <div className="flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground break-all">
            {alert?.rule_name ?? 'Alert'}
          </h1>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      )}

      {alert && !isLoading && (
        <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <AlertDetailView
            alert={alert}
            bracketingReadings={bracketingReadings as Array<{ timestamp: string; value: number }>}
            loading={false}
          />
        </div>
      )}
    </div>
  );
}
```

Two things to confirm against the existing code rather than assume:

- **Parameter names.** Read `lib/validations/v2/reading.validation.ts` (`listReadingsQuerySchema`) and `readingsApi.list` in `lib/api/v2-client.ts` before writing the query, and use whatever the device-filter and time-range parameters are actually called there. The design's only commitment is that no new endpoint is added — the existing readings endpoint already requires a time range, which `fired_at ± 15m` satisfies.
- **Retry behaviour.** `useAlertDetail` must not retry a 404 into a spinner loop — pass `config={{ retry: false }}` from this page, or set `retry: false` in the hook's defaults.

- [ ] **Step 5: Run tests and build**

Run: `pnpm test __tests__/unit/components/AlertDetailView.test.tsx && npx tsc --noEmit`
Expected: PASS, 6 tests; no type errors.

- [ ] **Step 6: Commit**

```bash
git add components/alerts/AlertDetailView.tsx app/alerts/[id]/page.tsx __tests__/unit/components/AlertDetailView.test.tsx
git commit -m "feat(alerting): add deep-linkable alert detail page"
```

---

### Task 17: Rule management UI

**Files:**
- Create: `components/alerts/AlertRuleList.tsx`
- Create: `components/alerts/CreateAlertRuleModal.tsx`
- Create: `app/alerts/rules/page.tsx`
- Test: `__tests__/unit/components/CreateAlertRuleModal.test.tsx`

`CreateAlertRuleModal` is modelled on `components/devices/CreateDeviceModal.tsx`. The one piece of real logic in it is mirroring the two server-side cross-field refinements client-side, so a user is told *before* submitting rather than getting a 400 back:

1. When `metric` is `value`, at least one `selector.types` entry is required.
2. `anomaly_score` thresholds are bounded 0–1; `battery_level` 0–100; `value` unconstrained.

The server remains the enforcement point — this is a UX affordance, not a security boundary.

**Interfaces:**
- Consumes: `useAlertRulesList`, `useCreateAlertRule`, `useUpdateAlertRule`, `useDeleteAlertRule` (Task 12); `useAdminAction`.
- Produces:
  - `export function AlertRuleList()`
  - `export function CreateAlertRuleModal({ isOpen, onClose })`
  - Default-exported `AlertRulesPage` at `/alerts/rules`

- [ ] **Step 1: Write the failing modal test**

Create `__tests__/unit/components/CreateAlertRuleModal.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { CreateAlertRuleModal } from '@/components/alerts/CreateAlertRuleModal';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: { alertRules: { create: jest.fn().mockResolvedValue({ data: { _id: 'r1' } }) } },
}));

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('CreateAlertRuleModal', () => {
  it("should block submit when metric is 'value' and no type is selected", async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() =>
      expect(screen.getByText(/select at least one reading type/i)).toBeInTheDocument()
    );
    expect(v2Api.alertRules.create).not.toHaveBeenCalled();
  });

  it('should reject an anomaly_score threshold above 1', async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/metric/i), { target: { value: 'anomaly_score' } });
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(screen.getByText(/between 0 and 1/i)).toBeInTheDocument());
    expect(v2Api.alertRules.create).not.toHaveBeenCalled();
  });

  it('should submit a valid rule', async () => {
    render(<CreateAlertRuleModal isOpen onClose={jest.fn()} />, { wrapper });

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'High temp' } });
    fireEvent.change(screen.getByLabelText(/threshold/i), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/temperature/i));
    fireEvent.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(v2Api.alertRules.create).toHaveBeenCalled());

    const payload = (v2Api.alertRules.create as jest.Mock).mock.calls[0][0];
    expect(payload.name).toBe('High temp');
    expect(payload.selector.types).toContain('temperature');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/components/CreateAlertRuleModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the modal**

Create `components/alerts/CreateAlertRuleModal.tsx` following `components/devices/CreateDeviceModal.tsx`:

- Controlled form state; fields: name, description, metric (`Select`), comparison (`Select`), threshold (number), severity (`Select`), `for_duration_seconds` (number, minutes in the UI × 60 on submit), `cooldown_seconds`, and a selector block with a multi-select of the 15 reading types plus optional building/floor/zone/tags (reuse `components/devices/TagInput.tsx` for tags)
- A `validate()` returning `Record<string, string>` implementing the two refinements above, with messages "Select at least one reading type when the metric is a raw value" and "Threshold must be between 0 and 1 for anomaly_score" / "…between 0 and 100 for battery_level"
- Submit via `useCreateAlertRule()`; `toast.success('Alert rule created')` on success then `onClose()`; `toast.error(err.message)` on failure
- Every input carries a `<label htmlFor>` so the tests above (and screen readers) can find it
- `metric` / `comparison` / `severity` use `components/ui/select.tsx`, whose contract is `{ value, onValueChange, options, label?, size? }` — **not** a native `<select>`, so there is no `onChange` and no `event.target.value`

**Building the request body needs care — a flat object literal will not compile.** `CreateAlertRuleBody` (`types/v2/alert.types.ts:121`) is `AlertRuleBodyBase & CreateAlertRuleCondition`, and `CreateAlertRuleCondition` is a **discriminated union on `metric`** where the `'value'` arm requires `selector.types` to be a non-empty tuple `[ReadingTypeName, ...ReadingTypeName[]]`. Two consequences:

1. Assembling `{ ...base, metric, comparison, threshold, selector }` from a `metric: AlertMetric` state variable fails: TypeScript cannot pick an arm from a union-typed discriminant.
2. Form state holds `types: ReadingTypeName[]`, which is not assignable to a non-empty tuple no matter which arm is chosen.

Branch on the discriminant and destructure the array to produce a genuinely non-empty tuple — **no `as` cast, which would defeat the type that exists precisely to make this state unrepresentable**:

```typescript
function buildCreateBody(form: RuleFormState): CreateAlertRuleBody | null {
  const base = {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    for_duration_seconds: form.durationMinutes * 60,
    severity: form.severity,
    cooldown_seconds: form.cooldownSeconds,
  };

  const selector = {
    ...(form.buildingId ? { building_id: form.buildingId } : {}),
    ...(form.floor !== '' ? { floor: Number(form.floor) } : {}),
    ...(form.zone ? { zone: form.zone } : {}),
    ...(form.tags.length ? { tags: form.tags } : {}),
  };

  if (form.metric === 'value') {
    // The destructure is what proves non-emptiness to the compiler.
    // validate() has already blocked this branch, so null is unreachable.
    const [firstType, ...restTypes] = form.types;
    if (!firstType) return null;

    return {
      ...base,
      metric: 'value',
      comparison: form.comparison,
      threshold: Number(form.threshold),
      selector: { ...selector, types: [firstType, ...restTypes] },
    };
  }

  return {
    ...base,
    metric: form.metric, // narrowed to 'anomaly_score' | 'battery_level'
    comparison: form.comparison,
    threshold: Number(form.threshold),
    selector,
  };
}
```

If you also build an edit path, note `UpdateAlertRuleBody` differs deliberately: whenever the condition is being changed, `selector` must be an **explicit key for every metric** — send `{}` for `anomaly_score`/`battery_level` rather than omitting it — because `updateAlertRuleSchema` gives `selector` no default and its atomic-group refinement tests `data.selector !== undefined`. The rationale is documented at `types/v2/alert.types.ts:123-139`.

- [ ] **Step 4: Write the rule list and page**

Create `components/alerts/AlertRuleList.tsx` following `ScheduleList`: card per rule showing name, `AlertSeverityBadge`, the condition via `describeCondition`, the selector rendered as chips, and an enabled toggle. Admin-only actions (toggle enabled, delete) render disabled with a tooltip for non-admins. Delete asks for confirmation via an inline confirm state — **never `window.confirm`**, which blocks the page.

Create `app/alerts/rules/page.tsx` with the same header shell as `app/alerts/page.tsx`, a back link to `/alerts`, a "New rule" button gated with `useAdminAction()` (matching `app/analytics/page.tsx`'s report button), `<AlertRuleList />`, and the modal.

- [ ] **Step 5: Run tests and build**

Run: `pnpm test __tests__/unit/components && npx tsc --noEmit && pnpm build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/alerts/AlertRuleList.tsx components/alerts/CreateAlertRuleModal.tsx app/alerts/rules/page.tsx __tests__/unit/components/CreateAlertRuleModal.test.tsx
git commit -m "feat(alerting): add alert rule management UI"
```

---

### Task 18: AnomalyPanel rename, dashboard widget, and navigation

**`components/AlertsPanel.tsx` is NOT orphaned.** Issue #99 and the parent design both describe it as such; that is stale. It is imported at `app/analytics/page.tsx:5` and rendered at `:84`, and commit `9c80aa9` *"refactor(ui): give AlertsPanel a home, drop CriticalDevicesList"* already discharged parent §3.3. **Deleting it breaks the build.** The diagnosis survives the correction — a component named `AlertsPanel` rendering anomaly data is exactly the confusion this phase exists to remove — but the resolution is a rename, not a deletion.

**Files:**
- Rename: `components/AlertsPanel.tsx` → `components/AnomalyPanel.tsx`
- Modify: `app/analytics/page.tsx` (one import, one JSX tag)
- Create: `components/dashboard/ActiveAlertsWidget.tsx`
- Modify: `app/page.tsx` (render the widget)
- Modify: `components/TopNav.tsx` (nav item + count badge)
- Test: `__tests__/unit/components/ActiveAlertsWidget.test.tsx`

- [ ] **Step 1: Confirm the reference set before renaming**

Run: `grep -rn "AlertsPanel" --include="*.ts" --include="*.tsx" . | grep -v node_modules`
Expected: exactly three hits — `app/analytics/page.tsx:5`, `app/analytics/page.tsx:84`, and `components/AlertsPanel.tsx` itself. If the count differs, update every hit found rather than the three listed here.

- [ ] **Step 2: Rename the component**

```bash
git mv components/AlertsPanel.tsx components/AnomalyPanel.tsx
```

Inside `components/AnomalyPanel.tsx`, rename `AlertsPanelProps` → `AnomalyPanelProps` and `AlertsPanel` → `AnomalyPanel`, and update the visible heading text so it says "Anomalies" rather than "Alerts". No behaviour change — it stays on `/analytics`, which is where anomaly data belongs under this design's separation of the two surfaces.

In `app/analytics/page.tsx`, change the import to `import AnomalyPanel from '@/components/AnomalyPanel';` and the JSX tag to `<AnomalyPanel … />`.

- [ ] **Step 3: Verify the rename**

Run: `npx tsc --noEmit && grep -rn "AlertsPanel" --include="*.tsx" . | grep -v node_modules`
Expected: no type errors, no remaining `AlertsPanel` references.

- [ ] **Step 4: Write the failing widget test**

Create `__tests__/unit/components/ActiveAlertsWidget.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { ActiveAlertsWidget } from '@/components/dashboard/ActiveAlertsWidget';

jest.mock('@/lib/query/hooks', () => ({
  useAlertsList: jest.fn(),
}));

import { useAlertsList } from '@/lib/query/hooks';

const mockUseAlertsList = useAlertsList as jest.Mock;

describe('ActiveAlertsWidget', () => {
  it('should show a loading state', () => {
    mockUseAlertsList.mockReturnValue({ data: undefined, isLoading: true, error: null });

    const { container } = render(<ActiveAlertsWidget />);

    expect(container.querySelector('.animate-pulse, .animate-spin')).not.toBeNull();
  });

  it('should show an all-clear state when nothing is open', () => {
    mockUseAlertsList.mockReturnValue({ data: [], isLoading: false, error: null });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText(/no active alerts/i)).toBeInTheDocument();
  });

  it('should render alert rows with status and severity', () => {
    mockUseAlertsList.mockReturnValue({
      data: [
        {
          _id: 'a1',
          rule_name: 'High temp',
          device_id: 'device_001',
          status: 'firing',
          severity: 'critical',
          metric: 'value',
          comparison: 'gt',
          threshold: 30,
          trigger_value: 42,
          fired_at: '2026-08-01T12:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText('High temp')).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
    expect(screen.getByText(/firing/i)).toBeInTheDocument();
  });

  it('should link each row to its alert page', () => {
    mockUseAlertsList.mockReturnValue({
      data: [
        {
          _id: 'a1',
          rule_name: 'High temp',
          device_id: 'device_001',
          status: 'firing',
          severity: 'critical',
          metric: 'value',
          comparison: 'gt',
          threshold: 30,
          trigger_value: 42,
          fired_at: '2026-08-01T12:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<ActiveAlertsWidget />);

    expect(screen.getByRole('link', { name: /high temp/i })).toHaveAttribute('href', '/alerts/a1');
  });

  it('should show an error state', () => {
    mockUseAlertsList.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Write the widget**

Create `components/dashboard/ActiveAlertsWidget.tsx` **fresh against `GET /api/v2/alerts`**, rather than lifting the layout out of `AnomalyPanel`. It is a different data shape — status, acknowledgement, duration — and copying a panel built for anomaly rows would import assumptions that no longer hold.

- `'use client'`; `useAlertsList({ limit: 5, sortBy: 'severity', sortDirection: 'desc' })` — this returns **critical first** only because Task 12 Step 0 replaced the lexical severity sort with a rank-based one. If you find criticals sorting last, that fix is missing; do not paper over it in this component.
- `Card` shell matching the other `components/dashboard/*` widgets
- Rows: `AlertSeverityBadge`, `AlertStatusBadge`, rule name as a `<Link href={`/alerts/${alert._id}`}>`, device id, and time since `fired_at`
- Loading: skeleton with `animate-pulse`. Empty: "No active alerts". Error: "Failed to load alerts"
- Footer link "View all alerts" → `/alerts`

Render `<ActiveAlertsWidget />` in `app/page.tsx` alongside the existing dashboard widgets.

- [ ] **Step 6: Add navigation**

In `components/TopNav.tsx`, add `Bell` to the `lucide-react` import and insert into `navItems` **between Devices and Maintenance**:

```typescript
  { href: '/alerts', label: 'Alerts', icon: Bell },
```

Add an open-alert count badge. Because `navItems` is a module-level constant, the badge is rendered in the map rather than baked into the item:

```typescript
  const { data: openAlertCount = 0 } = useOpenAlertCount();
```

Use `useOpenAlertCount()` (Task 12), **not** `useAlertsList({ limit: 100 }).data?.length`. The API caps `limit` at 100, so a real storm would freeze the badge at "100" — and because `TopNav` renders on every route, the list variant would fetch 100 full alert documents on every navigation just to display one integer. The count hook asks for one row and reads `pagination.total`.

and inside the desktop and mobile item renderers:

```tsx
  {item.href === '/alerts' && openAlertCount > 0 && (
    <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground">
      {openAlertCount}
    </span>
  )}
```

The badge is the single clearest signal that this is an operations tool rather than a set of charts. Keep it live by adding `usePusherAlerts(() => queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all }))` in `TopNav` — the same invalidation `AlertToaster` performs, so the count updates on the same event that raises the toast.

- [ ] **Step 7: Verify**

Run: `pnpm test __tests__/unit/components && npx tsc --noEmit && pnpm build`
Expected: clean. `/alerts` must be reachable from the nav in both the desktop and mobile menus.

- [ ] **Step 8: Commit**

```bash
git add components/AnomalyPanel.tsx app/analytics/page.tsx components/dashboard/ActiveAlertsWidget.tsx app/page.tsx components/TopNav.tsx __tests__/unit/components/ActiveAlertsWidget.test.tsx
git commit -m "refactor(ui): rename AlertsPanel to AnomalyPanel and add alerts nav and widget"
```

---

### Task 19: Seed alert rules

**Without seeded rules the entire phase is invisible to a visitor**, which would defeat its purpose. `/alerts` must be populated on first load.

**Files:**
- Create: `scripts/v2/alert-rule-seeds.ts`
- Modify: `scripts/v2/seed-v2.ts`
- Test: `__tests__/unit/lib/seed-alert-rules.test.ts`

**The seeds live in their own module, not in `seed-v2.ts`.** `scripts/v2/seed-v2.ts` calls `seed()` at module scope (`seed-v2.ts:313`), so importing it from a test would run the seeder against the test database and wipe it. A separate side-effect-free module is importable from both the seed script and the test.

**The four rules**, chosen so the demo exercises every branch of the design:

| Rule | Metric | Condition | Duration | Why it is in the set |
| --- | --- | --- | --- | --- |
| High temperature | `value` | `> 30` on `temperature` | 300s | Exercises the `pending → firing` promotion |
| Power spike | `value` | `> 4000` on `power` | 0s | Fires immediately; the common case |
| Low battery | `battery_level` | `< 20`, **no `selector.types`** | 0s | The rule that motivates optional `selector.types` — battery is a device property, and a rule that only watched temperature sensors' batteries would be close to useless |
| High anomaly score | `anomaly_score` | `>= 0.85`, no `selector.types` | 0s | The single coupling point between alerting and the existing anomaly endpoint |

**Interfaces:**
- Consumes: `AlertRuleV2` (Task 1).
- Produces, from `scripts/v2/alert-rule-seeds.ts`: `export interface AlertRuleSeed`, `export function buildAlertRuleSeeds(): AlertRuleSeed[]`. No side effects on import.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/seed-alert-rules.test.ts`:

```typescript
/**
 * Seed Alert Rule Tests
 *
 * The seeded rule set is what makes Phase 4 visible on a fresh database, and it
 * is also the fixture that proves optional selector.types is load-bearing.
 */

import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import { buildAlertRuleSeeds } from '@/scripts/v2/alert-rule-seeds';

describe('buildAlertRuleSeeds', () => {
  it('should produce four rules', () => {
    expect(buildAlertRuleSeeds()).toHaveLength(4);
  });

  it('should include a duration-gated temperature rule', () => {
    const rule = buildAlertRuleSeeds().find(r => r.selector.types?.includes('temperature'));

    expect(rule).toBeDefined();
    expect(rule!.metric).toBe('value');
    expect(rule!.for_duration_seconds).toBe(300);
  });

  it('should include a fleet-wide low-battery rule with no selector.types', () => {
    const rule = buildAlertRuleSeeds().find(r => r.metric === 'battery_level');

    expect(rule).toBeDefined();
    expect(rule!.selector.types).toBeUndefined();
    expect(rule!.comparison).toBe('lt');
  });

  it('should include an anomaly_score rule bounded to 0-1', () => {
    const rule = buildAlertRuleSeeds().find(r => r.metric === 'anomaly_score');

    expect(rule).toBeDefined();
    expect(rule!.threshold).toBeGreaterThanOrEqual(0);
    expect(rule!.threshold).toBeLessThanOrEqual(1);
  });

  it('should give every value-metric rule a non-empty selector.types', () => {
    for (const rule of buildAlertRuleSeeds())
      if (rule.metric === 'value') expect(rule.selector.types!.length).toBeGreaterThan(0);
  });

  it('should produce rules the model accepts', async () => {
    await AlertRuleV2.insertMany(buildAlertRuleSeeds());

    expect(await AlertRuleV2.countDocuments({})).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/seed-alert-rules.test.ts`
Expected: FAIL — `buildAlertRuleSeeds` is not exported.

- [ ] **Step 3: Add the seeds**

Create `scripts/v2/alert-rule-seeds.ts` — **no imports with side effects, no `mongoose.connect`, nothing that runs on import**:

```typescript
/**
 * Starter alert rules.
 *
 * Lives in its own module rather than in seed-v2.ts, which invokes seed() at
 * module scope — importing that from a test would wipe the test database.
 */

// ============================================================================
// ALERT RULE SEEDS
// ============================================================================

export interface AlertRuleSeed {
  name: string;
  description: string;
  enabled: boolean;
  selector: { types?: string[] };
  metric: 'value' | 'anomaly_score' | 'battery_level';
  comparison: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  for_duration_seconds: number;
  severity: 'info' | 'warning' | 'critical';
  cooldown_seconds: number;
  audit: {
    created_at: Date;
    created_by: string;
    updated_at: Date;
    updated_by: string;
  };
}

/**
 * A small rule set so /alerts is populated on first load. Without it the whole
 * phase is invisible to a visitor.
 */
export function buildAlertRuleSeeds(): AlertRuleSeed[] {
  const now = new Date();
  const audit = {
    created_at: now,
    created_by: 'sys-seed-agent',
    updated_at: now,
    updated_by: 'sys-seed-agent',
  };

  return [
    {
      name: 'High temperature',
      description: 'Temperature sustained above 30 C for five minutes.',
      enabled: true,
      selector: { types: ['temperature'] },
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      for_duration_seconds: 300,
      severity: 'critical',
      cooldown_seconds: 900,
      audit,
    },
    {
      name: 'Power spike',
      description: 'Instantaneous power draw above 4000 W.',
      enabled: true,
      selector: { types: ['power'] },
      metric: 'value',
      comparison: 'gt',
      threshold: 4000,
      for_duration_seconds: 0,
      severity: 'warning',
      cooldown_seconds: 600,
      audit,
    },
    {
      // No selector.types: battery is a DEVICE property, so a rule that only
      // watched temperature sensors' batteries would be close to useless. This
      // is the rule that motivates making selector.types optional.
      name: 'Low battery',
      description: 'Any device reporting below 20% battery.',
      enabled: true,
      selector: {},
      metric: 'battery_level',
      comparison: 'lt',
      threshold: 20,
      for_duration_seconds: 0,
      severity: 'warning',
      cooldown_seconds: 3600,
      audit,
    },
    {
      name: 'High anomaly score',
      description: 'Any reading scored 0.85 or higher by anomaly detection.',
      enabled: true,
      selector: {},
      metric: 'anomaly_score',
      comparison: 'gte',
      threshold: 0.85,
      for_duration_seconds: 0,
      severity: 'info',
      cooldown_seconds: 300,
      audit,
    },
  ];
}
```

Then in `scripts/v2/seed-v2.ts`, import both:

```typescript
import AlertRuleV2 from '../../models/v2/AlertRuleV2';
import { buildAlertRuleSeeds } from './alert-rule-seeds';
```

Inside `seed()`, extend the clear step and add an insert step:

```typescript
    await DeviceV2.deleteMany({});
    await ReadingV2.deleteMany({});
    await AlertRuleV2.deleteMany({});
```

```typescript
    // Seed alert rules so /alerts is populated on first load.
    console.log('🔔 Seeding alert rules...');
    const alertRules = buildAlertRuleSeeds();
    await AlertRuleV2.insertMany(alertRules);
    console.log(`✅ Inserted ${alertRules.length} alert rules\n`);
```

Add `Alert rules: ${alertRules.length}` to the seed summary block.

**Do not delete `alerts_v2` in the seed.** The seed wipes devices and readings; alerts referencing wiped devices are swept to `device_inactive` on the next cron run, which is the correct behaviour and also demonstrates the sweep.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/seed-alert-rules.test.ts`
Expected: PASS, 6 tests. If `jest` cannot resolve `@/scripts/v2/alert-rule-seeds`, check that `scripts/` is not excluded in `tsconfig.json` — `jest.config.js` maps `^@/(.*)$` to `<rootDir>/$1`, so resolution is a tsconfig concern, not a jest one.

Also confirm the new module has no import side effects: `npx tsx -e "import('./scripts/v2/alert-rule-seeds.ts').then(m => console.log(m.buildAlertRuleSeeds().length))"` must print `4` without connecting to MongoDB.

- [ ] **Step 5: Run the seed end to end against a local database**

Run: `pnpm seed` (requires a local `MONGODB_URI` in `.env.local`; the script refuses a non-local target without `--force`)
Expected: 500 devices, readings, and 4 alert rules. Then run `pnpm create-indexes-v2 && pnpm verify-indexes` and confirm the eight new alert indexes are reported present.

- [ ] **Step 6: Commit**

```bash
git add scripts/v2/alert-rule-seeds.ts scripts/v2/seed-v2.ts __tests__/unit/lib/seed-alert-rules.test.ts
git commit -m "feat(alerting): seed a starter alert rule set"
```

---

### Task 20: End-to-end coverage

**Files:**
- Create: `e2e/alerts.spec.ts`

E2E runs with `E2E_TESTING=true`, which `proxy.ts` uses to bypass Clerk. Follow the shape of `e2e/device-detail.spec.ts`: `page.goto`, `waitForLoadState('load')`, generous `timeout` values on the first visible assertion, and tolerant locators.

**Interfaces:**
- Consumes: everything above.
- Produces: no exports.

- [ ] **Step 1: Write the spec**

Create `e2e/alerts.spec.ts`:

```typescript
/**
 * Alerts E2E Tests
 *
 * Requires a seeded database with alert rules (pnpm seed) and at least one cron
 * run to have produced alerts (GET /api/v2/cron/simulate).
 */

import { test, expect } from '@playwright/test';

test.describe('Alerts', () => {
  test('should render the active alerts page', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible({ timeout: 15000 });
  });

  test('should reach alerts from the top navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    await page.getByRole('link', { name: /alerts/i }).first().click();

    await expect(page).toHaveURL(/\/alerts/);
  });

  test('should switch to history via the status filter', async ({ page }) => {
    await page.goto('/alerts?status=resolved');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible({ timeout: 15000 });
  });

  test('should survive a refresh on a deep-linked alert', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    const firstAlert = page.locator('a[href^="/alerts/"]').first();
    const count = await firstAlert.count();
    test.skip(count === 0, 'No alerts present in the seeded database');

    await firstAlert.click();
    await expect(page).toHaveURL(/\/alerts\/[0-9a-f]{24}/);

    const url = page.url();
    await page.reload();
    await page.waitForLoadState('load');

    expect(page.url()).toBe(url);
    await expect(page.getByText(/breached since/i)).toBeVisible({ timeout: 15000 });
  });

  test('should render the styled 404 for an unknown alert id', async ({ page }) => {
    await page.goto('/alerts/507f1f77bcf86cd799439011');
    await page.waitForLoadState('load');

    await expect(page.getByText(/not found|404/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('should reach the rules page', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    await page.getByRole('link', { name: /manage rules/i }).click();

    await expect(page).toHaveURL(/\/alerts\/rules/);
    await expect(page.getByText(/high temperature/i)).toBeVisible({ timeout: 15000 });
  });

  test('should render acknowledge and resolve as gated controls rather than hiding them', async ({
    page,
  }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    const ack = page.getByRole('button', { name: /acknowledge/i }).first();
    const count = await ack.count();
    test.skip(count === 0, 'No open alerts present in the seeded database');

    // Present either way — a visitor should learn the workflow exists.
    await expect(ack).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm test:e2e e2e/alerts.spec.ts`
Expected: PASS (some tests may `skip` if the seeded database has no alerts yet — run `pnpm seed`, then hit `GET /api/v2/cron/simulate` with the `SEED_SECRET` bearer token a few times first, so the duration-gated temperature rule has time to promote).

- [ ] **Step 3: Full verification**

Run: `pnpm lint && npx tsc --noEmit && pnpm test:coverage && pnpm build`
Expected: lint clean, no type errors, coverage at or above `branches 55 / functions 55 / lines 75 / statements 75`, clean production build.

- [ ] **Step 4: Commit**

```bash
git add e2e/alerts.spec.ts
git commit -m "test(alerting): add end-to-end coverage for the alerts UI"
```

---

## Task Dependency Graph

```
Task 1 (AlertRuleV2) ──┬─→ Task 3 (validation + wire types) ──┬─→ Task 10 (alerts API) ──┐
                       │                                       │                          │
Task 2 (AlertV2) ──────┘                                       └─→ Task 11 (rules API) ───┤
                                                                                           │
Task 4 (cache + metrics) ─→ Task 6 (rule cache) ─→ Task 7 (evaluate) ─→ Task 8 (sweep)     │
                       ↑                              ↑                     │              │
Task 5 (selector) ─────┴──────────────────────────────┘                     ↓              ↓
                                                                    Task 9 (write paths)  Task 12 (client + hooks)
                                                                            │              │
                                                                            └─→ Task 13 (Pusher notify) ─→ Task 14 (subscribe + toasts)
                                                                                                                 │
                                                       Task 15 (badges + list + /alerts) ←─────────────────────────┘
                                                              │
                                                              ├─→ Task 16 (detail page)
                                                              ├─→ Task 17 (rules UI)
                                                              └─→ Task 18 (rename + widget + nav)
                                                                          │
                                                              Task 19 (seed) ─→ Task 20 (E2E)
```

Tasks 1, 2, 4, and 5 have no dependencies on each other and can be done in any order. Tasks 10 and 11 can run in parallel with Tasks 6–9 once Tasks 1–3 land. Task 20 must be last — it needs a seeded database and every route in place.

## Issue Mapping

| Issue | Tasks |
| --- | --- |
| #96 Add AlertRule and Alert models with validation | 1, 2, 3 |
| #97 Evaluate alert rules on both write paths | 4, 5, 6, 7, 8, 9 |
| #98 Lifecycle and API | 10, 11 |
| #99 UI | 12, 15, 16, 17, 18 |
| #100 Pusher delivery | 13, 14 |
| Cross-cutting (seed, E2E) | 19, 20 |

## Definition of Done

The phase is complete when all of the following hold:

- `pnpm lint && npx tsc --noEmit && pnpm test:coverage && pnpm build` is clean, with coverage at or above the configured thresholds.
- `pnpm create-indexes-v2 && pnpm verify-indexes` reports all eight new alert indexes present.
- A fresh `pnpm seed` followed by a few authenticated `GET /api/v2/cron/simulate` calls produces visible alerts on `/alerts`.
- An anonymous visitor can read `/alerts`, `/alerts/[id]`, and `/alerts/rules`. On a **demo deployment** (`NEXT_PUBLIC_DEMO_MODE=true`) they see Acknowledge / Resolve / New rule **disabled with a tooltip** rather than hidden; off demo mode a non-admin sees them hidden, matching every other screen. Both behaviours come from `useAdminAction()` — no screen hand-rolls this.
- A member `PATCH` to `/api/v2/alerts/[id]` returns 403; an admin `PATCH` returns 200.
- Triggering a rule while `/alerts` is open in a browser raises a toast and updates the nav badge without a refresh.
- `grep -rn "AlertsPanel" --include="*.tsx" .` returns nothing outside `node_modules`.
- `GET /api/v2/alerts?sortBy=severity&sortDirection=desc` returns **critical before warning before info**, and the dashboard widget shows the same order.
- The cron path broadcasts only readings that persisted — `newReadings` appears in no `pusherServer.trigger` call.
- `/alerts?status=resolved&severity=critical` survives a reload and a browser Back, and `/alerts` carries no default parameters in its query string.
