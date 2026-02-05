import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

// ============================================================================
// CUSTOM ERRORS
// ============================================================================

export type ScheduleTransitionCode =
  | 'ALREADY_COMPLETED'
  | 'ALREADY_CANCELLED'
  | 'CANNOT_COMPLETE_CANCELLED'
  | 'CANNOT_CANCEL_COMPLETED';

export class ScheduleTransitionError extends Error {
  code: ScheduleTransitionCode;

  constructor(code: ScheduleTransitionCode, message: string) {
    super(message);
    this.name = 'ScheduleTransitionError';
    this.code = code;
  }
}

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

/**
 * Service type enum
 */
export type ServiceType = 'firmware_update' | 'calibration' | 'emergency_fix' | 'general_maintenance';

/**
 * Schedule status enum
 */
export type ScheduleStatus = 'scheduled' | 'completed' | 'cancelled';

/**
 * Schedule audit trail interface
 */
export interface IScheduleAudit {
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
  completed_at?: Date;
  completed_by?: string;
  cancelled_at?: Date;
  cancelled_by?: string;
}

/**
 * Main ScheduleV2 interface
 */
export interface IScheduleV2 {
  _id: Types.ObjectId;
  device_id: string; // Reference to DeviceV2._id
  service_type: ServiceType;
  scheduled_date: Date;
  status: ScheduleStatus;
  notes?: string;
  audit: IScheduleAudit;
}

// ============================================================================
// MONGOOSE SCHEMA
// ============================================================================

/**
 * Audit trail sub-schema
 */
const AuditSchema = new Schema<IScheduleAudit>(
  {
    created_at: { type: Date, default: () => new Date() },
    created_by: { type: String, required: true },
    updated_at: { type: Date, default: () => new Date() },
    updated_by: { type: String, required: true },
    completed_at: { type: Date },
    completed_by: { type: String },
    cancelled_at: { type: Date },
    cancelled_by: { type: String },
  },
  { _id: false }
);

/**
 * Main ScheduleV2 Schema
 */
const ScheduleV2Schema = new Schema<IScheduleV2>(
  {
    device_id: {
      type: String,
      required: true,
      index: true,
    },
    service_type: {
      type: String,
      enum: ['firmware_update', 'calibration', 'emergency_fix', 'general_maintenance'],
      required: true,
    },
    scheduled_date: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['scheduled', 'completed', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    notes: {
      type: String,
      maxlength: 1000,
    },
    audit: {
      type: AuditSchema,
      required: true,
    },
  },
  {
    collection: 'schedules_v2',
    timestamps: false,
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// Compound index for common queries: status + scheduled_date
ScheduleV2Schema.index({ status: 1, scheduled_date: 1 });

// Compound index for device-specific queries: device_id + status
ScheduleV2Schema.index({ device_id: 1, status: 1 });

// Index for audit queries
ScheduleV2Schema.index({ 'audit.created_at': 1 });

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Pre-save middleware to update audit.updated_at
 */
ScheduleV2Schema.pre('save', function () {
  if (!this.isNew) this.audit.updated_at = new Date();
});

/**
 * Pre-findOneAndUpdate middleware to update audit.updated_at
 */
ScheduleV2Schema.pre('findOneAndUpdate', function () {
  this.set({ 'audit.updated_at': new Date() });
});

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Find schedules by device ID
 */
ScheduleV2Schema.statics.findByDevice = function (deviceId: string, status?: ScheduleStatus) {
  const filter: Record<string, unknown> = { device_id: deviceId };
  if (status) filter.status = status;
  return this.find(filter).sort({ scheduled_date: 1 });
};

/**
 * Find upcoming scheduled maintenance
 */
ScheduleV2Schema.statics.findUpcoming = function (
  daysAhead: number = 30,
  filter: Record<string, unknown> = {}
) {
  const now = new Date();
  const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  return this.find({
    ...filter,
    status: 'scheduled',
    scheduled_date: { $gte: now, $lte: futureDate },
  }).sort({ scheduled_date: 1 });
};

/**
 * Mark a schedule as completed (atomic operation)
 */
ScheduleV2Schema.statics.complete = async function (id: string, completedBy: string) {
  const now = new Date();
  const result = await this.findOneAndUpdate(
    { _id: id, status: 'scheduled' },
    {
      $set: {
        status: 'completed',
        'audit.updated_at': now,
        'audit.updated_by': completedBy,
        'audit.completed_at': now,
        'audit.completed_by': completedBy,
      },
    },
    { new: true }
  );

  if (!result) {
    // Determine the specific error
    const existing = await this.findById(id);
    if (!existing) return null;
    if (existing.status === 'completed') throw new ScheduleTransitionError('ALREADY_COMPLETED', 'Schedule is already completed');
    if (existing.status === 'cancelled') throw new ScheduleTransitionError('CANNOT_COMPLETE_CANCELLED', 'Cannot complete a cancelled schedule');
  }

  return result;
};

/**
 * Cancel a schedule (atomic operation)
 */
ScheduleV2Schema.statics.cancel = async function (id: string, cancelledBy: string) {
  const now = new Date();
  const result = await this.findOneAndUpdate(
    { _id: id, status: 'scheduled' },
    {
      $set: {
        status: 'cancelled',
        'audit.updated_at': now,
        'audit.updated_by': cancelledBy,
        'audit.cancelled_at': now,
        'audit.cancelled_by': cancelledBy,
      },
    },
    { new: true }
  );

  if (!result) {
    // Determine the specific error
    const existing = await this.findById(id);
    if (!existing) return null;
    if (existing.status === 'completed') throw new ScheduleTransitionError('CANNOT_CANCEL_COMPLETED', 'Cannot cancel a completed schedule');
    if (existing.status === 'cancelled') throw new ScheduleTransitionError('ALREADY_CANCELLED', 'Schedule is already cancelled');
  }

  return result;
};

// ============================================================================
// INTERFACE FOR STATIC METHODS
// ============================================================================

export interface IScheduleV2Model extends Model<IScheduleV2> {
  findByDevice(
    deviceId: string,
    status?: ScheduleStatus
  ): ReturnType<Model<IScheduleV2>['find']>;
  findUpcoming(
    daysAhead?: number,
    filter?: Record<string, unknown>
  ): ReturnType<Model<IScheduleV2>['find']>;
  complete(id: string, completedBy: string): Promise<(IScheduleV2 & Document) | null>;
  cancel(id: string, cancelledBy: string): Promise<(IScheduleV2 & Document) | null>;
}

// ============================================================================
// MODEL EXPORT
// ============================================================================

/**
 * ScheduleV2 Model
 * Collection: schedules_v2
 */
const ScheduleV2 =
  (mongoose.models.ScheduleV2 as unknown as IScheduleV2Model) ||
  mongoose.model<IScheduleV2, IScheduleV2Model>('ScheduleV2', ScheduleV2Schema);

export default ScheduleV2;
