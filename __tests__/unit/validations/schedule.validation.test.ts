/**
 * Schedule Validation Schema Tests
 *
 * Tests for Zod validation schemas in schedule.validation.ts
 */

import {
  serviceTypeSchema,
  scheduleStatusSchema,
  createScheduleSchema,
  updateScheduleSchema,
  listSchedulesQuerySchema,
  getScheduleQuerySchema,
  scheduleIdParamSchema,
} from '@/lib/validations/v2/schedule.validation';

describe('Schedule Validation Schemas', () => {
  // ==========================================================================
  // SERVICE TYPE SCHEMA TESTS
  // ==========================================================================

  describe('serviceTypeSchema', () => {
    it('should accept valid service types', () => {
      const validTypes = ['firmware_update', 'calibration', 'emergency_fix', 'general_maintenance'];

      for (const type of validTypes) {
        const result = serviceTypeSchema.safeParse(type);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toBe(type);
      }
    });

    it('should reject invalid service types', () => {
      const invalidTypes = ['invalid', 'FIRMWARE_UPDATE', 'repair', '', 'Calibration'];

      for (const type of invalidTypes) {
        const result = serviceTypeSchema.safeParse(type);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // SCHEDULE STATUS SCHEMA TESTS
  // ==========================================================================

  describe('scheduleStatusSchema', () => {
    it('should accept valid statuses', () => {
      const validStatuses = ['scheduled', 'completed', 'cancelled'];

      for (const status of validStatuses) {
        const result = scheduleStatusSchema.safeParse(status);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toBe(status);
      }
    });

    it('should reject invalid statuses', () => {
      const invalidStatuses = ['pending', 'active', 'SCHEDULED', '', 'in_progress'];

      for (const status of invalidStatuses) {
        const result = scheduleStatusSchema.safeParse(status);
        expect(result.success).toBe(false);
      }
    });
  });

  // ==========================================================================
  // CREATE SCHEDULE SCHEMA TESTS
  // ==========================================================================

  describe('createScheduleSchema', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const validInput = {
      device_ids: ['device_001'],
      service_type: 'calibration',
      scheduled_date: futureDate,
    };

    it('should accept valid create input', () => {
      const result = createScheduleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept multiple device IDs', () => {
      const result = createScheduleSchema.safeParse({
        ...validInput,
        device_ids: ['device_001', 'device_002', 'device_003'],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.device_ids.length).toBe(3);
    });

    it('should accept up to 100 device IDs', () => {
      const deviceIds = Array.from({ length: 100 }, (_, i) => `device_${i.toString().padStart(3, '0')}`);
      const result = createScheduleSchema.safeParse({
        ...validInput,
        device_ids: deviceIds,
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 100 device IDs', () => {
      const deviceIds = Array.from({ length: 101 }, (_, i) => `device_${i}`);
      const result = createScheduleSchema.safeParse({
        ...validInput,
        device_ids: deviceIds,
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty device_ids array', () => {
      const result = createScheduleSchema.safeParse({
        ...validInput,
        device_ids: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing device_ids', () => {
      const { device_ids: _, ...withoutDeviceIds } = validInput;
      const result = createScheduleSchema.safeParse(withoutDeviceIds);
      expect(result.success).toBe(false);
    });

    it('should accept all valid service types', () => {
      const types = ['firmware_update', 'calibration', 'emergency_fix', 'general_maintenance'];

      for (const type of types) {
        const result = createScheduleSchema.safeParse({ ...validInput, service_type: type });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid service type', () => {
      const result = createScheduleSchema.safeParse({
        ...validInput,
        service_type: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject past scheduled_date', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = createScheduleSchema.safeParse({
        ...validInput,
        scheduled_date: pastDate,
      });
      expect(result.success).toBe(false);
    });

    it('should accept Date objects for scheduled_date', () => {
      const result = createScheduleSchema.safeParse({
        ...validInput,
        scheduled_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid datetime format', () => {
      const result = createScheduleSchema.safeParse({
        ...validInput,
        scheduled_date: 'not-a-date',
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional notes', () => {
      const result = createScheduleSchema.safeParse({
        ...validInput,
        notes: 'Some maintenance notes',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.notes).toBe('Some maintenance notes');
    });

    it('should reject notes over 1000 characters', () => {
      const result = createScheduleSchema.safeParse({
        ...validInput,
        notes: 'a'.repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it('should accept notes at exactly 1000 characters', () => {
      const result = createScheduleSchema.safeParse({
        ...validInput,
        notes: 'a'.repeat(1000),
      });
      expect(result.success).toBe(true);
    });

    it('should transform string dates to Date objects', () => {
      const result = createScheduleSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scheduled_date).toBeInstanceOf(Date);
      }
    });
  });

  // ==========================================================================
  // UPDATE SCHEDULE SCHEMA TESTS
  // ==========================================================================

  describe('updateScheduleSchema', () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    it('should accept scheduled_date update', () => {
      const result = updateScheduleSchema.safeParse({ scheduled_date: futureDate });
      expect(result.success).toBe(true);
    });

    it('should accept status update to completed', () => {
      const result = updateScheduleSchema.safeParse({ status: 'completed' });
      expect(result.success).toBe(true);
    });

    it('should accept status update to cancelled', () => {
      const result = updateScheduleSchema.safeParse({ status: 'cancelled' });
      expect(result.success).toBe(true);
    });

    it('should reject status update to scheduled', () => {
      const result = updateScheduleSchema.safeParse({ status: 'scheduled' });
      expect(result.success).toBe(false);
    });

    it('should accept notes update', () => {
      const result = updateScheduleSchema.safeParse({ notes: 'Updated notes' });
      expect(result.success).toBe(true);
    });

    it('should accept multiple field updates', () => {
      const result = updateScheduleSchema.safeParse({
        scheduled_date: futureDate,
        notes: 'Rescheduled due to conflict',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty update (no fields)', () => {
      const result = updateScheduleSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject past scheduled_date', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = updateScheduleSchema.safeParse({ scheduled_date: pastDate });
      expect(result.success).toBe(false);
    });

    it('should reject notes over 1000 characters', () => {
      const result = updateScheduleSchema.safeParse({ notes: 'a'.repeat(1001) });
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // LIST SCHEDULES QUERY SCHEMA TESTS
  // ==========================================================================

  describe('listSchedulesQuerySchema', () => {
    it('should accept empty query with defaults', () => {
      const result = listSchedulesQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.include_all).toBe(false);
      }
    });

    it('should accept pagination parameters', () => {
      const result = listSchedulesQuerySchema.safeParse({
        page: 2,
        limit: 50,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    it('should transform string pagination to numbers', () => {
      const result = listSchedulesQuerySchema.safeParse({
        page: '3',
        limit: '25',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.limit).toBe(25);
      }
    });

    it('should accept device_id filter', () => {
      const result = listSchedulesQuerySchema.safeParse({ device_id: 'device_001' });
      expect(result.success).toBe(true);
    });

    it('should accept single status filter', () => {
      const result = listSchedulesQuerySchema.safeParse({ status: 'scheduled' });
      expect(result.success).toBe(true);
    });

    it('should accept array status filter', () => {
      const result = listSchedulesQuerySchema.safeParse({ status: ['scheduled', 'completed'] });
      expect(result.success).toBe(true);
    });

    it('should accept comma-separated status filter', () => {
      const result = listSchedulesQuerySchema.safeParse({ status: 'scheduled,completed' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status in comma-separated filter', () => {
      const result = listSchedulesQuerySchema.safeParse({ status: 'scheduled,invalid' });
      expect(result.success).toBe(false);
    });

    it('should accept single service_type filter', () => {
      const result = listSchedulesQuerySchema.safeParse({ service_type: 'calibration' });
      expect(result.success).toBe(true);
    });

    it('should accept comma-separated service_type filter', () => {
      const result = listSchedulesQuerySchema.safeParse({
        service_type: 'calibration,firmware_update',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid sort fields', () => {
      const validSortFields = ['scheduled_date', 'created_at', 'updated_at', 'status', 'service_type'];

      for (const sortBy of validSortFields) {
        const result = listSchedulesQuerySchema.safeParse({ sortBy });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid sort field', () => {
      const result = listSchedulesQuerySchema.safeParse({ sortBy: 'invalid_field' });
      expect(result.success).toBe(false);
    });

    it('should accept sort direction', () => {
      for (const dir of ['asc', 'desc']) {
        const result = listSchedulesQuerySchema.safeParse({ sortDirection: dir });
        expect(result.success).toBe(true);
      }
    });

    it('should accept include_all as boolean', () => {
      const result = listSchedulesQuerySchema.safeParse({ include_all: true });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.include_all).toBe(true);
    });

    it('should transform include_all string to boolean', () => {
      const result = listSchedulesQuerySchema.safeParse({ include_all: 'true' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.include_all).toBe(true);
    });

    it('should accept date range filters', () => {
      const result = listSchedulesQuerySchema.safeParse({
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // GET SCHEDULE QUERY SCHEMA TESTS
  // ==========================================================================

  describe('getScheduleQuerySchema', () => {
    it('should accept empty query with defaults', () => {
      const result = getScheduleQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.include_device).toBe(false);
    });

    it('should accept include_device as boolean', () => {
      const result = getScheduleQuerySchema.safeParse({ include_device: true });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.include_device).toBe(true);
    });

    it('should transform include_device string to boolean', () => {
      const result = getScheduleQuerySchema.safeParse({ include_device: 'true' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.include_device).toBe(true);
    });

    it('should treat non-true string as false', () => {
      const result = getScheduleQuerySchema.safeParse({ include_device: 'false' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.include_device).toBe(false);
    });
  });

  // ==========================================================================
  // SCHEDULE AUDIT SCHEMA TESTS
  // ==========================================================================

  describe('scheduleAuditSchema', () => {
    it('should accept valid audit data', () => {
      const { scheduleAuditSchema } = require('@/lib/validations/v2/schedule.validation');
      const result = scheduleAuditSchema.safeParse({
        created_by: 'admin@example.com',
        updated_by: 'admin@example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        // Defaults should be applied
        expect(result.data.created_at).toBeInstanceOf(Date);
        expect(result.data.updated_at).toBeInstanceOf(Date);
      }
    });

    it('should accept explicit dates', () => {
      const { scheduleAuditSchema } = require('@/lib/validations/v2/schedule.validation');
      const now = new Date();
      const result = scheduleAuditSchema.safeParse({
        created_at: now,
        created_by: 'admin@example.com',
        updated_at: now,
        updated_by: 'admin@example.com',
        completed_at: now,
        completed_by: 'admin@example.com',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing created_by', () => {
      const { scheduleAuditSchema } = require('@/lib/validations/v2/schedule.validation');
      const result = scheduleAuditSchema.safeParse({
        updated_by: 'admin@example.com',
      });
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // SCHEDULE ID PARAM SCHEMA TESTS
  // ==========================================================================

  describe('scheduleIdParamSchema', () => {
    it('should accept valid MongoDB ObjectId', () => {
      const validIds = [
        '507f1f77bcf86cd799439011',
        '000000000000000000000000',
        'aaBBccDDeeFF001122334455',
      ];

      for (const id of validIds) {
        const result = scheduleIdParamSchema.safeParse({ id });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid ObjectId formats', () => {
      const invalidIds = [
        '',
        '123',
        'not-an-objectid',
        '507f1f77bcf86cd79943901', // 23 chars
        '507f1f77bcf86cd7994390111', // 25 chars
        '507f1f77bcf86cd79943901G', // invalid char
      ];

      for (const id of invalidIds) {
        const result = scheduleIdParamSchema.safeParse({ id });
        expect(result.success).toBe(false);
      }
    });
  });
});
