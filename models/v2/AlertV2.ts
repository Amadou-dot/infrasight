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

/**
 * A write that would leave `status` and `is_open` disagreeing.
 *
 * Distinct from AlertTransitionError, which is about a legal-but-refused
 * lifecycle move made by a caller. This one is always a programming error:
 * `is_open` is a denormalization of `status` (see the invariant on IAlertV2),
 * and a document where they disagree silently corrupts the partial unique
 * dedup index rather than failing anywhere visible.
 */
export class AlertInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertInvariantError';
  }
}

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

export type AlertStatus = 'pending' | 'firing' | 'acknowledged' | 'resolved';
export type AlertResolution = 'manual' | 'auto' | 'stale' | 'device_inactive';

/**
 * The invariant, as a function rather than as prose: `is_open` is nothing but a
 * denormalization of `status`. Every enforcement point below derives from this
 * one expression, so there is exactly one place to change if the status set
 * ever grows a second terminal state.
 */
export function isOpenForStatus(status: AlertStatus): boolean {
  return status !== 'resolved';
}

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
   * Invariant: `is_open === isOpenForStatus(status)`, ENFORCED at the write
   * path (see "INVARIANT ENFORCEMENT" below) rather than merely asserted here.
   *
   * Denormalized because the dedup index needs an equality predicate — a
   * `status: { $in: [...] }` partialFilterExpression would require MongoDB 6.0+.
   *
   * The reason enforcement is not optional: a resolved document that kept
   * `is_open: true` sits in the partial unique index forever, so the evaluator
   * (which loads open episodes purely on `is_open` and branches only on
   * `'pending'`) can never re-fire or resolve that (rule, device) pair again —
   * silently, with no metric. A type-level guarantee buys nothing here, since
   * the evaluator's bulk insert reaches the driver through a cast.
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
    is_open: {
      type: Boolean,
      required: true,
      validate: {
        // Document validation only. `this` is the document on create()/save()/
        // insertMany(), and on the documents Mongoose builds from a bulkWrite
        // `insertOne` op before sending it. Under `runValidators: true` on a
        // query `this` would instead be the Query, which has no `status` — the
        // guard below returns true in that case and the update middleware
        // further down covers those paths properly.
        validator: function (this: unknown, value: boolean): boolean {
          const status = (this as { status?: AlertStatus } | null)?.status;
          if (status === undefined) return true;
          return value === isOpenForStatus(status);
        },
        message: props =>
          `is_open ${props.value} contradicts status — is_open must equal (status !== 'resolved'). ` +
          'An inconsistent document corrupts the partial unique dedup index.',
      },
    },
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
// INVARIANT ENFORCEMENT
// ============================================================================

/**
 * Apply the status/is_open invariant to ONE write payload, in place.
 *
 * Three outcomes, and the asymmetry between them is deliberate:
 *
 *  - `status` alone      -> derive `is_open`. An update names only the fields
 *                           it changes, so `{ status: 'firing' }` is a
 *                           legitimate partial write whose `is_open` is
 *                           implied. Rejecting it would break a correct
 *                           existing writer (the evaluator's pending ->
 *                           firing promotion sets status only), and deriving
 *                           makes drift structurally impossible instead of
 *                           merely detectable.
 *  - both, disagreeing   -> throw. There is no reading of the caller's intent
 *                           that is safe to guess at.
 *  - `is_open` alone     -> throw. The stored `status` is not knowable from
 *                           here, so this write cannot be checked — and it is
 *                           exactly the shape the drift takes. No writer in
 *                           the codebase does this; one that needs to should
 *                           set both.
 *
 * Returns true if it changed `payload`, so query middleware can write the
 * update back rather than relying on reference semantics.
 */
function applyIsOpenInvariant(payload: Record<string, unknown>, context: string): boolean {
  const hasStatus = payload.status !== undefined;
  const hasIsOpen = payload.is_open !== undefined;

  if (!hasStatus && !hasIsOpen) return false;

  if (!hasStatus)
    throw new AlertInvariantError(
      `${context} sets is_open without status. is_open is a denormalization of status ` +
        "(is_open === status !== 'resolved') and cannot be verified on its own — set both, " +
        'or set status alone and let the model derive is_open.'
    );

  const required = isOpenForStatus(payload.status as AlertStatus);

  if (!hasIsOpen) {
    payload.is_open = required;
    return true;
  }

  if (payload.is_open !== required)
    throw new AlertInvariantError(
      `${context} sets status '${String(payload.status)}' with is_open ${String(payload.is_open)}; ` +
        `is_open must be ${required}. An inconsistent document stays in the partial unique dedup ` +
        'index forever and the evaluator can never re-fire or resolve that (rule, device) pair again.'
    );

  return false;
}

/**
 * The sub-documents of an update that can carry field values.
 *
 * `$set` and `$setOnInsert` explicitly; an operator-free update document is
 * MongoDB shorthand for `$set` (and a `replaceOne` replacement is a whole
 * document), so that case is handled too. Query middleware runs BEFORE
 * Mongoose casts `{ status: x }` into `{ $set: { status: x } }`, so both
 * shapes genuinely reach here.
 */
function invariantTargets(update: Record<string, unknown>): Record<string, unknown>[] {
  const targets: Record<string, unknown>[] = [];
  let sawOperator = false;

  for (const key of Object.keys(update)) {
    if (!key.startsWith('$')) continue;
    sawOperator = true;
    if (key !== '$set' && key !== '$setOnInsert') continue;
    const value = update[key];
    if (value && typeof value === 'object' && !Array.isArray(value))
      targets.push(value as Record<string, unknown>);
  }

  if (!sawOperator) targets.push(update);
  return targets;
}

function enforceInvariantOnUpdate(update: unknown, context: string): boolean {
  // An aggregation-pipeline update is an array of stages. This model never
  // uses one, and silently ignoring it would be a hole in the guard.
  if (Array.isArray(update))
    throw new AlertInvariantError(
      `${context} uses an aggregation-pipeline update, which the status/is_open invariant guard ` +
        'cannot inspect. Use $set so the invariant stays enforceable.'
    );

  if (!update || typeof update !== 'object') return false;

  let mutated = false;
  for (const target of invariantTargets(update as Record<string, unknown>))
    mutated = applyIsOpenInvariant(target, context) || mutated;

  return mutated;
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

AlertV2Schema.pre('save', function () {
  if (!this.isNew) this.audit.updated_at = new Date();
});

/**
 * Covers every single-document update path: `updateOne`, `updateMany`,
 * `findOneAndUpdate` (which `acknowledge` and `resolve` both use) and
 * `replaceOne`. Query middleware does NOT run for ops inside a `bulkWrite` —
 * the `bulkWrite` hook below covers those.
 */
for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'] as const)
  AlertV2Schema.pre(hook, function () {
    const update = this.getUpdate();
    if (enforceInvariantOnUpdate(update, `AlertV2.${hook}()`))
      this.setUpdate(update as Record<string, unknown>);
  });

/**
 * The evaluator and the staleness sweep both write through `bulkWrite`, which
 * bypasses query middleware entirely. This hook runs before Mongoose casts the
 * ops, so it sees exactly what the caller queued.
 *
 * `insertOne` is checked here as well as by the `is_open` validator above: with
 * `{ ordered: false }` — which both callers use — a document that fails
 * validation is DROPPED from the batch and merely decorated onto the result,
 * not thrown. That is silent, and silence is the whole complaint. Throwing here
 * makes an inconsistent insert fail the call.
 */
AlertV2Schema.pre('bulkWrite', function (ops: unknown) {
  if (!Array.isArray(ops)) return;

  for (const op of ops as Record<string, Record<string, unknown>>[]) {
    if (!op || typeof op !== 'object') continue;

    if (op.insertOne?.document)
      applyIsOpenInvariant(
        op.insertOne.document as Record<string, unknown>,
        'AlertV2.bulkWrite() insertOne'
      );

    if (op.updateOne?.update)
      enforceInvariantOnUpdate(op.updateOne.update, 'AlertV2.bulkWrite() updateOne');

    if (op.updateMany?.update)
      enforceInvariantOnUpdate(op.updateMany.update, 'AlertV2.bulkWrite() updateMany');

    if (op.replaceOne?.replacement)
      applyIsOpenInvariant(
        op.replaceOne.replacement as Record<string, unknown>,
        'AlertV2.bulkWrite() replaceOne'
      );
  }
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
