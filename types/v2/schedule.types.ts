/**
 * TypeScript Type Definitions for ScheduleV2 Model
 *
 * These types provide type-safe access to ScheduleV2 documents and API interactions.
 * Types align with:
 * - Mongoose model: /models/v2/ScheduleV2.ts
 * - Zod schemas: /lib/validations/v2/schedule.validation.ts
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Service type for maintenance schedules
 */
export type ServiceType =
  | 'firmware_update'
  | 'calibration'
  | 'emergency_fix'
  | 'general_maintenance';

/**
 * Schedule status
 */
export type ScheduleStatus = 'scheduled' | 'completed' | 'cancelled';

// ============================================================================
// NESTED INTERFACES
// ============================================================================

/**
 * Schedule audit trail information
 */
export interface ScheduleAudit {
  /** Creation timestamp */
  created_at: Date;
  /** User/system that created the schedule */
  created_by: string;
  /** Last update timestamp */
  updated_at: Date;
  /** User/system that last updated the schedule */
  updated_by: string;
  /** Completion timestamp */
  completed_at?: Date;
  /** User who marked as completed */
  completed_by?: string;
  /** Cancellation timestamp */
  cancelled_at?: Date;
  /** User who cancelled */
  cancelled_by?: string;
}

// ============================================================================
// MAIN DOCUMENT INTERFACE
// ============================================================================

/**
 * Full ScheduleV2 document interface (as stored in MongoDB)
 */
export interface ScheduleV2Document {
  /** MongoDB ObjectId */
  _id: string;
  /** Reference to DeviceV2._id */
  device_id: string;
  /** Type of maintenance service */
  service_type: ServiceType;
  /** Scheduled date for the service */
  scheduled_date: Date;
  /** Current status */
  status: ScheduleStatus;
  /** Optional notes */
  notes?: string;
  /** Audit trail */
  audit: ScheduleAudit;
}

// ============================================================================
// INPUT/REQUEST TYPES
// ============================================================================

/**
 * Input for creating new schedules (POST /api/v2/schedules)
 * Supports bulk creation via device_ids array
 */
export interface CreateScheduleInput {
  /** Array of device IDs (1-100) */
  device_ids: string[];
  /** Type of maintenance service */
  service_type: ServiceType;
  /** Scheduled date (must be in the future) */
  scheduled_date: Date | string;
  /** Optional notes */
  notes?: string;
}

/**
 * Input for updating a schedule (PATCH /api/v2/schedules/:id)
 */
export interface UpdateScheduleInput {
  /** New scheduled date (must be in the future) */
  scheduled_date?: Date | string;
  /** Status transition */
  status?: ScheduleStatus;
  /** Updated notes */
  notes?: string;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for listing schedules (GET /api/v2/schedules)
 */
export interface ListSchedulesQuery {
  /** Page number (1-indexed) */
  page?: number;
  /** Items per page (max 100) */
  limit?: number;
  /** Sort field */
  sortBy?: 'scheduled_date' | 'created_at' | 'updated_at' | 'status' | 'service_type';
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Filter by device ID */
  device_id?: string;
  /** Filter by status */
  status?: ScheduleStatus | ScheduleStatus[];
  /** Filter by service type */
  service_type?: ServiceType | ServiceType[];
  /** Start date for scheduled_date range */
  startDate?: string;
  /** End date for scheduled_date range */
  endDate?: string;
  /** Include all statuses (default: only scheduled) */
  include_all?: boolean;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Schedule response with optional device info
 */
export interface ScheduleV2Response {
  _id: string;
  device_id: string;
  service_type: ServiceType;
  scheduled_date: string; // ISO date string in API responses
  status: ScheduleStatus;
  notes?: string;
  audit: {
    created_at: string;
    created_by: string;
    updated_at: string;
    updated_by: string;
    completed_at?: string;
    completed_by?: string;
    cancelled_at?: string;
    cancelled_by?: string;
  };
  /** Device details when include_device=true */
  device?: {
    _id: string;
    serial_number: string;
    type: string;
    location: {
      building_id: string;
      floor: number;
      room_name: string;
    };
  };
}

/**
 * Bulk create response
 */
export interface BulkCreateScheduleResponse {
  created: ScheduleV2Response[];
  count: number;
}

/**
 * Paginated schedule list response
 */
export interface ScheduleListResponse {
  schedules: ScheduleV2Response[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
