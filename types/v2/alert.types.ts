/**
 * TypeScript Type Definitions for the Alerting Subsystem
 *
 * Client-safe: no mongoose or model imports. Nothing imports from this file
 * yet — `lib/pusher-context.tsx` will consume `AlertEvent` once Task 13/14
 * wires up alert delivery over Pusher.
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

/**
 * Selector variant for `metric: 'value'` rules. `types` is required and must
 * list at least one reading type: a bare value threshold is meaningless across
 * mixed units — 30 is a reasonable temperature ceiling and an absurd power one.
 * Enforced by `typesRequiredForValueMetric` in alert-rule.validation.ts.
 */
export interface ValueMetricSelector extends Omit<AlertRuleSelector, 'types'> {
  types: [ReadingTypeName, ...ReadingTypeName[]];
}

/**
 * The `metric` / `comparison` / `threshold` / `selector` group for CREATE,
 * discriminated on `metric` so the two states `createAlertRuleSchema` always
 * rejects are unrepresentable:
 * - `metric: 'value'` with `selector.types` missing or empty.
 * - a `threshold` outside the metric's valid range.
 *
 * `selector` is optional for `anomaly_score` / `battery_level` because
 * `createAlertRuleSchema` defaults it to `{}` when the key is omitted
 * (`selector: alertRuleSelectorSchema.default({})`).
 *
 * Threshold bounds (`anomaly_score` in [0, 1], `battery_level` in [0, 100]) are
 * enforced by Zod's `thresholdWithinMetricBounds` (alert-rule.validation.ts),
 * not by these types — TypeScript has no numeric refinement types, so
 * `threshold` stays `number` on every arm; the bounds are documented instead.
 */
export type CreateAlertRuleCondition =
  | {
      metric: 'value';
      comparison: AlertComparison;
      threshold: number;
      selector: ValueMetricSelector;
    }
  | {
      metric: 'anomaly_score';
      comparison: AlertComparison;
      /** Must be within [0, 1]. Enforced by Zod, not representable in TypeScript. */
      threshold: number;
      selector?: AlertRuleSelector;
    }
  | {
      metric: 'battery_level';
      comparison: AlertComparison;
      /** Must be within [0, 100]. Enforced by Zod, not representable in TypeScript. */
      threshold: number;
      selector?: AlertRuleSelector;
    };

interface AlertRuleBodyBase {
  name: string;
  description?: string;
  enabled?: boolean;
  for_duration_seconds?: number;
  severity: AlertSeverity;
  cooldown_seconds?: number;
}

export type CreateAlertRuleBody = AlertRuleBodyBase & CreateAlertRuleCondition;

/**
 * The same condition group for UPDATE — deliberately a separate type from
 * `CreateAlertRuleCondition`, not a reuse of it, because `selector`'s
 * requiredness differs between create and update:
 *
 * `updateAlertRuleSchema` gives `selector` no default
 * (`selector: alertRuleSelectorSchema.optional()`), and its atomic-group
 * refinement tests `data.selector !== undefined`. So whenever `metric` is
 * being changed, `selector` must be an explicit key for EVERY metric — send
 * `{}` for `anomaly_score` / `battery_level` if there is nothing to
 * constrain — not just for `'value'`. Confirmed against the live schema:
 * `{ metric: 'anomaly_score', comparison: 'gt', threshold: 0.5 }` with no
 * `selector` key is always rejected ("metric, comparison, threshold and
 * selector must be updated together — send all four or none"), while the same
 * body plus `selector: {}` is accepted. `metric: 'value'` still additionally
 * requires `selector.types` to be non-empty, same as create.
 */
type UpdateAlertRuleCondition =
  | {
      metric: 'value';
      comparison: AlertComparison;
      threshold: number;
      selector: ValueMetricSelector;
    }
  | {
      metric: 'anomaly_score';
      comparison: AlertComparison;
      /** Must be within [0, 1]. Enforced by Zod, not representable in TypeScript. */
      threshold: number;
      selector: AlertRuleSelector;
    }
  | {
      metric: 'battery_level';
      comparison: AlertComparison;
      /** Must be within [0, 100]. Enforced by Zod, not representable in TypeScript. */
      threshold: number;
      selector: AlertRuleSelector;
    };

/**
 * None of `metric` / `comparison` / `threshold` / `selector` present — the
 * "leave the condition untouched" half of the atomic-group rule below.
 */
type NoConditionUpdate = {
  metric?: undefined;
  comparison?: undefined;
  threshold?: undefined;
  selector?: undefined;
};

/**
 * `metric`, `comparison`, `threshold` and `selector` must be updated together —
 * send all four or none (`updateAlertRuleSchema`'s `CONDITION_FIELDS` check,
 * alert-rule.validation.ts:144-154). A partial condition like `{ threshold: 5 }`
 * is therefore not expressible: it satisfies neither an `UpdateAlertRuleCondition`
 * arm (missing `metric`/`comparison`/`selector`) nor `NoConditionUpdate`
 * (`threshold` must be absent or `undefined`).
 */
export type UpdateAlertRuleBody = Partial<AlertRuleBodyBase> &
  (UpdateAlertRuleCondition | NoConditionUpdate);

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
 *
 * `actor` is 'system' for automatic resolution. For a manual resolution it MUST
 * be `userId` — the Clerk user ID returned by `requireAdmin()` — and NEVER an
 * email, because this payload reaches every connected client.
 *
 * Concretely: use the `userId` from `requireAdmin()`. Do NOT use `auditUser` or
 * `getAuditUser(userId, user)` (lib/auth/index.ts) to populate this field —
 * `getAuditUser` resolves to `user.email` whenever Clerk has one on file, which
 * is exactly the leak this field must not have. `auditUser`/`getAuditUser`
 * remain correct for audit-trail fields (e.g. `audit.resolved_by`), which are
 * never broadcast; they are wrong specifically for this Pusher payload.
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
