/**
 * Type-level contracts for the alerting subsystem.
 *
 * MOST OF THIS FILE IS CHECKED BY `npx tsc --noEmit`, NOT BY JEST. ts-jest runs
 * with `isolatedModules: true` (jest.config.js), which strips types without
 * checking them — so a broken assertion here shows up as a `tsc` failure and a
 * GREEN jest run. That is deliberate: these are compile-time invariants, and
 * `tsc` is the gate that enforces them. The handful of real `it()` blocks below
 * exist only to prove the runtime side of the same contracts still behaves.
 *
 * A `@ts-expect-error` that STOPS being an error is itself a `tsc` failure
 * ("Unused '@ts-expect-error' directive"), so the negative assertions cannot
 * quietly rot into no-ops.
 *
 * Three findings converge here:
 *   - F1: the reading type list is copied by hand into several modules, and an
 *     omission is silent at runtime (no bucket -> zero rules -> no alerts).
 *   - E2: `redactAuditForDemo` used to be identity-typed, so a route that
 *     skipped it looked exactly like a route that called it.
 *   - E4: `CreateAlertRuleInput` / `UpdateAlertRuleInput` used to be flat
 *     `z.infer` types that accepted request shapes the API always 400s.
 */

// Every import here except `@/lib/alerting/redact` is `import type`, so this
// file pulls in no React component and no mongoose model at runtime — the
// assertions below are checked by `tsc`, not by loading anything.
import type { z } from 'zod';
import type { ReadingTypeInList } from '@/models/v2/AlertRuleV2';
import type { ReadingType as ModelReadingType } from '@/models/v2/ReadingV2';
import type { DeviceType as ModelDeviceType } from '@/models/v2/DeviceV2';
import type { ReadingType as ClientReadingType, DeviceType as ClientDeviceType } from '@/types/v2';
import type {
  ReadingTypeName,
  CreateAlertRuleBody,
  UpdateAlertRuleBody,
} from '@/types/v2/alert.types';
import type { DEVICE_TYPES as FILTER_MODAL_DEVICE_TYPES } from '@/app/devices/_components/DeviceFilterModal';
import type { readingTypeSchema } from '@/lib/validations/v2/reading.validation';
import type { deviceTypeSchema } from '@/lib/validations/v2/device.validation';
import type {
  updateAlertRuleSchema,
  CreateAlertRuleInput,
  UpdateAlertRuleInput,
} from '@/lib/validations/v2/alert-rule.validation';
import { redactAuditForDemo, jsonRedacted, type Redacted } from '@/lib/alerting/redact';

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Invariant (not merely bivariant) type equality. The conditional-in-a-generic
 * trick is what makes `Equal<{a?: string}, {a: string | undefined}>` false —
 * a plain mutual-`extends` check would call those equal and miss exactly the
 * optionality drift these assertions are meant to catch.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** One-directional assignability, for the cases where equality is too strong. */
type Extends<A, B> = [A] extends [B] ? true : false;

/** Fails to compile unless `T` is exactly `true`. */
type Expect<T extends true> = T;

// ============================================================================
// F1 — every hand-maintained copy of the reading type list must agree
// ============================================================================
//
// An omission here is invisible at runtime: `buildRuleBuckets`
// (lib/alerting/rule-cache.ts) seeds one bucket per READING_TYPES entry,
// `evaluateReadings` looks a reading's type up with `byType.get(type) ?? []`,
// and a fleet-wide rule (no `selector.types`) is expanded across the same list.
// One missing entry therefore silences alerting for that reading type
// completely, including rules that never named a type at all — with no error,
// no metric, no log, and the rule still showing as Enabled in the UI.
//
// The Mongoose `enum` arrays and the runtime shape of the Zod enums are checked
// separately, at RUNTIME, in __tests__/unit/models/AlertRuleV2.test.ts —
// `tsc` cannot see inside a `new Schema({ enum: [...] })`.

type _ReadingTypesMatchesModelUnion = Expect<Equal<ReadingTypeInList, ModelReadingType>>;
type _ClientReadingTypeMatchesModel = Expect<Equal<ClientReadingType, ModelReadingType>>;
type _ReadingTypeNameMatchesModel = Expect<Equal<ReadingTypeName, ModelReadingType>>;
type _ReadingZodEnumMatchesModel = Expect<
  Equal<z.infer<typeof readingTypeSchema>, ModelReadingType>
>;

// Device types and reading types are ONE list in this codebase (CLAUDE.md's
// "15 Device/Reading Types"): a device of type X emits readings of type X, and
// `metric: 'value'` alert rules select devices by reading type. If that ever
// stops being true by design, this is the assertion to change — deliberately,
// and with the rule bucketer in hand — rather than something to let drift.
type _DeviceTypeMatchesReadingType = Expect<Equal<ModelDeviceType, ModelReadingType>>;
type _ClientDeviceTypeMatchesModel = Expect<Equal<ClientDeviceType, ModelDeviceType>>;
type _DeviceZodEnumMatchesModel = Expect<Equal<z.infer<typeof deviceTypeSchema>, ModelDeviceType>>;

// The device list page's filter options. `import type` of a value binding is
// fully erased, so this node-environment test never loads the React component.
// A type missing there is not a runtime failure — it is simply unfilterable in
// the UI, which is why nothing else would catch it.
type FilterModalDeviceType = (typeof FILTER_MODAL_DEVICE_TYPES)[number];
type _FilterModalMatchesDeviceType = Expect<Equal<FilterModalDeviceType, ModelDeviceType>>;

// ============================================================================
// E4 — the rule-create / rule-update request types
// ============================================================================

/** Every body the hand-written union permits must be a body the schema accepts. */
type _CreateBodyIsAccepted = Expect<Extends<CreateAlertRuleBody, CreateAlertRuleInput>>;
type _UpdateBodyIsAccepted = Expect<
  Extends<UpdateAlertRuleBody, z.input<typeof updateAlertRuleSchema>>
>;

/**
 * And the reverse, which is the direction that was actually broken: the schema
 * must not accept a CONDITION shape the hand-written union forbids. Before
 * `createAlertRuleSchema` became a discriminated union this was false — the
 * flat schema's `z.input` allowed `metric: 'value'` with `selector` absent, and
 * the API 400d every such request.
 *
 * Scoped to the condition group for two measured reasons, both of which are
 * seams rather than drift:
 *
 *   - `enabled`. The schema is `z.union([z.boolean(), z.string().transform(…)])`,
 *     so it also accepts the string `'true'`; `CreateAlertRuleBody` describes
 *     what the UI sends, which is always a real boolean. Verified by isolating
 *     each base field: `enabled` is the only one that differs.
 *   - `selector.types`. Zod's `.min(1)` enforces non-emptiness at RUNTIME but
 *     infers a plain array, while the union states it as `[T, ...T[]]`.
 *     TypeScript cannot recover the tuple, so that one axis is widened below
 *     rather than compared.
 */
type WidenNonEmptyTuple<T> = T extends readonly [infer X, ...unknown[]] ? X[] : T;
type WidenSelector<S> = { [K in keyof S]: WidenNonEmptyTuple<S[K]> };
type WidenCondition<C> = C extends { selector: infer S }
  ? Omit<C, 'selector'> & { selector: WidenSelector<S> }
  : C;

type ConditionGroup<T> = T extends unknown
  ? Pick<T, Extract<keyof T, 'metric' | 'comparison' | 'threshold' | 'selector'>>
  : never;

type _CreateSchemaConditionIsNoLooser = Expect<
  Extends<ConditionGroup<CreateAlertRuleInput>, ConditionGroup<WidenCondition<CreateAlertRuleBody>>>
>;

describe('alert rule request types', () => {
  it('accepts a complete value-metric create body', () => {
    const body: CreateAlertRuleInput = {
      name: 'High temperature',
      severity: 'critical',
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      selector: { types: ['temperature'] },
    };

    expect(body.metric).toBe('value');
  });

  it('rejects a value-metric create body with no selector', () => {
    // @ts-expect-error metric 'value' requires a selector listing at least one reading type
    const body: CreateAlertRuleInput = {
      name: 'High temperature',
      severity: 'critical',
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
    };

    expect(body.metric).toBe('value');
  });

  it('accepts a non-condition update', () => {
    const body: UpdateAlertRuleInput = { enabled: false };
    expect(body.enabled).toBe(false);
  });

  it('accepts a complete condition update', () => {
    const body: UpdateAlertRuleInput = {
      metric: 'value',
      comparison: 'gte',
      threshold: 40,
      selector: { types: ['temperature'] },
    };

    expect(body.threshold).toBe(40);
  });

  it('rejects a partial condition update', () => {
    // @ts-expect-error metric, comparison, threshold and selector move together
    const body: UpdateAlertRuleInput = { threshold: 5 };
    expect(body.threshold).toBe(5);
  });
});

// ============================================================================
// E2 — the redaction marker
// ============================================================================

interface AuditedRecord {
  _id: string;
  audit: { created_by: string; updated_by: string };
}

const unredacted: AuditedRecord = {
  _id: 'alert_1',
  audit: { created_by: 'admin@example.com', updated_by: 'admin@example.com' },
};

describe('redaction marker', () => {
  it('accepts a record that went through redactAuditForDemo', () => {
    const response = jsonRedacted(redactAuditForDemo(unredacted, true));
    expect(response.status).toBe(200);
  });

  it('refuses a record that did not', () => {
    // @ts-expect-error jsonRedacted only accepts a value carrying the Redacted<> marker
    const response = jsonRedacted(unredacted);
    expect(response.status).toBe(200);
  });

  it('preserves the input reference for a non-demo caller', () => {
    // The marker is phantom: no property is written, so this is still the exact
    // same object, which is the contract lib/alerting/redact.ts documents.
    expect(redactAuditForDemo(unredacted, false)).toBe(unredacted);
  });

  it('redacts every actor field but leaves system alone', () => {
    const redacted = redactAuditForDemo(
      { audit: { created_by: 'admin@example.com', resolved_by: 'system' } },
      true
    );

    expect(redacted.audit.created_by).toBe('an administrator');
    expect(redacted.audit.resolved_by).toBe('system');
  });
});

/** A redacted record stays usable as its underlying type. */
type _RedactedIsStillTheRecord = Expect<Extends<Redacted<AuditedRecord>, AuditedRecord>>;
/** …but the underlying type is NOT a redacted record — that is the whole point. */
type _RecordIsNotRedacted = Expect<Equal<Extends<AuditedRecord, Redacted<AuditedRecord>>, false>>;

/** Exported so the type-only aliases above are never "unused" to a linter. */
export type AlertingTypeContracts = [
  _ReadingTypesMatchesModelUnion,
  _ClientReadingTypeMatchesModel,
  _ReadingTypeNameMatchesModel,
  _ReadingZodEnumMatchesModel,
  _DeviceTypeMatchesReadingType,
  _ClientDeviceTypeMatchesModel,
  _DeviceZodEnumMatchesModel,
  _FilterModalMatchesDeviceType,
  _CreateBodyIsAccepted,
  _UpdateBodyIsAccepted,
  _CreateSchemaConditionIsNoLooser,
  _RedactedIsStillTheRecord,
  _RecordIsNotRedacted,
];
