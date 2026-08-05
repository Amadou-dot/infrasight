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
  // Optional, not just "always defaulted": the schema below gives `selector`
  // a `default: () => ({})`, but Mongoose's default `minimize` behavior strips
  // an empty nested object before it reaches Mongo, so a rule with no
  // constraints at all (e.g. the seeded "Low battery" rule) reads back with
  // this field genuinely absent. `matchesSelector` (lib/alerting/selector.ts)
  // and the rule bucketer (lib/alerting/rule-cache.ts) already treat it as
  // optional -- this makes the type honest about that runtime shape instead
  // of promising a guarantee `.lean()` doesn't keep.
  selector?: IAlertRuleSelector;
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
    // `default: undefined` overrides Mongoose's implicit `[]` default for
    // array paths, so an omitted field stays truly absent (no constraint)
    // rather than becoming a vacuous empty array.
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
