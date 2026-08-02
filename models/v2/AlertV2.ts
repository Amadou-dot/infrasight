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
