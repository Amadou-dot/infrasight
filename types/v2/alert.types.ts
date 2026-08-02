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
