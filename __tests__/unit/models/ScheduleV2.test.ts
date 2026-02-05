/**
 * ScheduleV2 Model Unit Tests
 *
 * Tests for the ScheduleV2 Mongoose model including:
 * - Document creation and validation
 * - Static methods (findByDevice, findUpcoming, complete, cancel)
 * - Middleware (pre-save, pre-findOneAndUpdate)
 * - ScheduleTransitionError custom error class
 */

import ScheduleV2, { ScheduleTransitionError } from '@/models/v2/ScheduleV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  createScheduleInput,
  createScheduleInputs,
  createScheduleOfType,
  createDeviceInput,
  resetCounters,
  VALID_SERVICE_TYPES,
  VALID_SCHEDULE_STATUSES,
} from '../../setup/factories';

describe('ScheduleV2 Model', () => {
  beforeEach(() => {
    resetCounters();
  });

  // ==========================================================================
  // SCHEDULE TRANSITION ERROR TESTS
  // ==========================================================================

  describe('ScheduleTransitionError', () => {
    it('should create error with correct name and code', () => {
      const error = new ScheduleTransitionError('ALREADY_COMPLETED', 'Already completed');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ScheduleTransitionError);
      expect(error.name).toBe('ScheduleTransitionError');
      expect(error.code).toBe('ALREADY_COMPLETED');
      expect(error.message).toBe('Already completed');
    });

    it('should support all transition codes', () => {
      const codes = [
        'ALREADY_COMPLETED',
        'ALREADY_CANCELLED',
        'CANNOT_COMPLETE_CANCELLED',
        'CANNOT_CANCEL_COMPLETED',
      ] as const;

      for (const code of codes) {
        const error = new ScheduleTransitionError(code, `Error: ${code}`);
        expect(error.code).toBe(code);
      }
    });
  });

  // ==========================================================================
  // DOCUMENT CREATION TESTS
  // ==========================================================================

  describe('Document Creation', () => {
    it('should create a schedule with valid data', async () => {
      const scheduleData = createScheduleInput({ device_id: 'device_001' });
      const schedule = await ScheduleV2.create(scheduleData);

      expect(schedule.device_id).toBe('device_001');
      expect(schedule.service_type).toBe('calibration');
      expect(schedule.status).toBe('scheduled');
      expect(schedule.scheduled_date).toBeInstanceOf(Date);
      expect(schedule.audit.created_by).toBe('test@example.com');
      expect(schedule.audit.updated_by).toBe('test@example.com');
    });

    it('should default status to scheduled', async () => {
      const data = createScheduleInput();
      delete (data as Record<string, unknown>).status;
      const schedule = await ScheduleV2.create(data);

      expect(schedule.status).toBe('scheduled');
    });

    it('should store optional notes', async () => {
      const schedule = await ScheduleV2.create(
        createScheduleInput({ notes: 'Important maintenance note' })
      );

      expect(schedule.notes).toBe('Important maintenance note');
    });

    it('should allow notes up to 1000 characters', async () => {
      const longNotes = 'a'.repeat(1000);
      const schedule = await ScheduleV2.create(
        createScheduleInput({ notes: longNotes })
      );

      expect(schedule.notes).toBe(longNotes);
    });

    it('should reject notes over 1000 characters', async () => {
      const tooLongNotes = 'a'.repeat(1001);

      await expect(
        ScheduleV2.create(createScheduleInput({ notes: tooLongNotes }))
      ).rejects.toThrow();
    });

    it('should enforce required device_id', async () => {
      const data = createScheduleInput();
      delete (data as Record<string, unknown>).device_id;

      await expect(ScheduleV2.create(data)).rejects.toThrow();
    });

    it('should enforce required service_type', async () => {
      const data = createScheduleInput();
      delete (data as Record<string, unknown>).service_type;

      await expect(ScheduleV2.create(data)).rejects.toThrow();
    });

    it('should enforce required scheduled_date', async () => {
      const data = createScheduleInput();
      delete (data as Record<string, unknown>).scheduled_date;

      await expect(ScheduleV2.create(data)).rejects.toThrow();
    });

    it('should enforce required audit', async () => {
      const data = createScheduleInput();
      delete (data as Record<string, unknown>).audit;

      await expect(ScheduleV2.create(data)).rejects.toThrow();
    });

    it('should accept all valid service types', async () => {
      for (const serviceType of VALID_SERVICE_TYPES) {
        const schedule = await ScheduleV2.create(
          createScheduleOfType(serviceType, {
            device_id: `device_type_${serviceType}`,
          })
        );
        expect(schedule.service_type).toBe(serviceType);
      }
    });

    it('should reject invalid service type', async () => {
      const data = createScheduleInput();
      (data as Record<string, unknown>).service_type = 'invalid_type';

      await expect(ScheduleV2.create(data)).rejects.toThrow(/validation/i);
    });

    it('should accept all valid statuses', async () => {
      for (const status of VALID_SCHEDULE_STATUSES) {
        const schedule = await ScheduleV2.create(
          createScheduleInput({
            device_id: `device_status_${status}`,
            status,
          })
        );
        expect(schedule.status).toBe(status);
      }
    });

    it('should reject invalid status', async () => {
      const data = createScheduleInput();
      (data as Record<string, unknown>).status = 'invalid_status';

      await expect(ScheduleV2.create(data)).rejects.toThrow(/validation/i);
    });

    it('should generate a MongoDB ObjectId for _id', async () => {
      const schedule = await ScheduleV2.create(createScheduleInput());

      expect(schedule._id).toBeDefined();
      expect(schedule._id.toString()).toMatch(/^[0-9a-fA-F]{24}$/);
    });

    it('should store audit timestamps', async () => {
      const schedule = await ScheduleV2.create(createScheduleInput());

      expect(schedule.audit.created_at).toBeInstanceOf(Date);
      expect(schedule.audit.updated_at).toBeInstanceOf(Date);
    });
  });

  // ==========================================================================
  // STATIC METHODS TESTS
  // ==========================================================================

  describe('Static Methods', () => {
    describe('findByDevice', () => {
      beforeEach(async () => {
        await ScheduleV2.insertMany([
          createScheduleInput({ device_id: 'device_A', service_type: 'calibration' }),
          createScheduleInput({ device_id: 'device_A', service_type: 'firmware_update', status: 'completed' }),
          createScheduleInput({ device_id: 'device_B', service_type: 'emergency_fix' }),
        ]);
      });

      it('should return all schedules for a device', async () => {
        const schedules = await ScheduleV2.findByDevice('device_A');

        expect(schedules.length).toBe(2);
        expect(schedules.every(s => s.device_id === 'device_A')).toBe(true);
      });

      it('should filter by status when provided', async () => {
        const schedules = await ScheduleV2.findByDevice('device_A', 'scheduled');

        expect(schedules.length).toBe(1);
        expect(schedules[0].status).toBe('scheduled');
      });

      it('should return empty array for non-existent device', async () => {
        const schedules = await ScheduleV2.findByDevice('non_existent');

        expect(schedules).toEqual([]);
      });

      it('should sort by scheduled_date ascending', async () => {
        const earlyDate = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
        const lateDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await ScheduleV2.deleteMany({});
        await ScheduleV2.insertMany([
          createScheduleInput({ device_id: 'device_C', scheduled_date: lateDate }),
          createScheduleInput({ device_id: 'device_C', scheduled_date: earlyDate }),
        ]);

        const schedules = await ScheduleV2.findByDevice('device_C');

        expect(schedules[0].scheduled_date.getTime()).toBeLessThanOrEqual(
          schedules[1].scheduled_date.getTime()
        );
      });
    });

    describe('findUpcoming', () => {
      beforeEach(async () => {
        const now = Date.now();
        await ScheduleV2.insertMany([
          createScheduleInput({
            device_id: 'upcoming_1',
            scheduled_date: new Date(now + 5 * 24 * 60 * 60 * 1000), // 5 days
          }),
          createScheduleInput({
            device_id: 'upcoming_2',
            scheduled_date: new Date(now + 15 * 24 * 60 * 60 * 1000), // 15 days
          }),
          createScheduleInput({
            device_id: 'upcoming_3',
            scheduled_date: new Date(now + 45 * 24 * 60 * 60 * 1000), // 45 days
          }),
          createScheduleInput({
            device_id: 'completed_1',
            scheduled_date: new Date(now + 5 * 24 * 60 * 60 * 1000),
            status: 'completed',
          }),
        ]);
      });

      it('should return schedules within default 30 days', async () => {
        const schedules = await ScheduleV2.findUpcoming();

        expect(schedules.length).toBe(2);
        expect(schedules.every(s => s.status === 'scheduled')).toBe(true);
      });

      it('should respect custom daysAhead parameter', async () => {
        const schedules = await ScheduleV2.findUpcoming(10);

        expect(schedules.length).toBe(1);
        expect(schedules[0].device_id).toBe('upcoming_1');
      });

      it('should accept additional filters', async () => {
        const schedules = await ScheduleV2.findUpcoming(30, {
          device_id: 'upcoming_1',
        });

        expect(schedules.length).toBe(1);
        expect(schedules[0].device_id).toBe('upcoming_1');
      });

      it('should exclude completed and cancelled schedules', async () => {
        const schedules = await ScheduleV2.findUpcoming(30);

        expect(schedules.every(s => s.status === 'scheduled')).toBe(true);
      });

      it('should sort by scheduled_date ascending', async () => {
        const schedules = await ScheduleV2.findUpcoming(60);

        for (let i = 1; i < schedules.length; i++) {
          expect(schedules[i].scheduled_date.getTime()).toBeGreaterThanOrEqual(
            schedules[i - 1].scheduled_date.getTime()
          );
        }
      });
    });

    describe('complete', () => {
      it('should mark a scheduled schedule as completed', async () => {
        const schedule = await ScheduleV2.create(createScheduleInput({ device_id: 'device_complete' }));

        const completed = await ScheduleV2.complete(schedule._id.toString(), 'admin@test.com');

        expect(completed).not.toBeNull();
        expect(completed!.status).toBe('completed');
        expect(completed!.audit.completed_at).toBeInstanceOf(Date);
        expect(completed!.audit.completed_by).toBe('admin@test.com');
        expect(completed!.audit.updated_by).toBe('admin@test.com');
      });

      it('should return null for non-existent schedule', async () => {
        const fakeId = '507f1f77bcf86cd799439011';
        const result = await ScheduleV2.complete(fakeId, 'admin@test.com');

        expect(result).toBeNull();
      });

      it('should throw ALREADY_COMPLETED for completed schedule', async () => {
        const schedule = await ScheduleV2.create(
          createScheduleInput({ device_id: 'device_dup_complete', status: 'completed' })
        );

        await expect(
          ScheduleV2.complete(schedule._id.toString(), 'admin@test.com')
        ).rejects.toThrow(ScheduleTransitionError);

        try {
          await ScheduleV2.complete(schedule._id.toString(), 'admin@test.com');
        } catch (error) {
          expect(error).toBeInstanceOf(ScheduleTransitionError);
          expect((error as ScheduleTransitionError).code).toBe('ALREADY_COMPLETED');
        }
      });

      it('should throw CANNOT_COMPLETE_CANCELLED for cancelled schedule', async () => {
        const schedule = await ScheduleV2.create(
          createScheduleInput({ device_id: 'device_cancel_complete', status: 'cancelled' })
        );

        try {
          await ScheduleV2.complete(schedule._id.toString(), 'admin@test.com');
        } catch (error) {
          expect(error).toBeInstanceOf(ScheduleTransitionError);
          expect((error as ScheduleTransitionError).code).toBe('CANNOT_COMPLETE_CANCELLED');
        }
      });
    });

    describe('cancel', () => {
      it('should mark a scheduled schedule as cancelled', async () => {
        const schedule = await ScheduleV2.create(createScheduleInput({ device_id: 'device_cancel' }));

        const cancelled = await ScheduleV2.cancel(schedule._id.toString(), 'admin@test.com');

        expect(cancelled).not.toBeNull();
        expect(cancelled!.status).toBe('cancelled');
        expect(cancelled!.audit.cancelled_at).toBeInstanceOf(Date);
        expect(cancelled!.audit.cancelled_by).toBe('admin@test.com');
        expect(cancelled!.audit.updated_by).toBe('admin@test.com');
      });

      it('should return null for non-existent schedule', async () => {
        const fakeId = '507f1f77bcf86cd799439011';
        const result = await ScheduleV2.cancel(fakeId, 'admin@test.com');

        expect(result).toBeNull();
      });

      it('should throw CANNOT_CANCEL_COMPLETED for completed schedule', async () => {
        const schedule = await ScheduleV2.create(
          createScheduleInput({ device_id: 'device_complete_cancel', status: 'completed' })
        );

        try {
          await ScheduleV2.cancel(schedule._id.toString(), 'admin@test.com');
        } catch (error) {
          expect(error).toBeInstanceOf(ScheduleTransitionError);
          expect((error as ScheduleTransitionError).code).toBe('CANNOT_CANCEL_COMPLETED');
        }
      });

      it('should throw ALREADY_CANCELLED for cancelled schedule', async () => {
        const schedule = await ScheduleV2.create(
          createScheduleInput({ device_id: 'device_dup_cancel', status: 'cancelled' })
        );

        try {
          await ScheduleV2.cancel(schedule._id.toString(), 'admin@test.com');
        } catch (error) {
          expect(error).toBeInstanceOf(ScheduleTransitionError);
          expect((error as ScheduleTransitionError).code).toBe('ALREADY_CANCELLED');
        }
      });
    });
  });

  // ==========================================================================
  // MIDDLEWARE TESTS
  // ==========================================================================

  describe('Middleware', () => {
    describe('pre-save', () => {
      it('should update audit.updated_at on save for existing documents', async () => {
        const schedule = await ScheduleV2.create(createScheduleInput({ device_id: 'device_middleware' }));
        const originalUpdatedAt = schedule.audit.updated_at;

        await new Promise(resolve => setTimeout(resolve, 10));

        schedule.notes = 'Updated notes';
        await schedule.save();

        expect(schedule.audit.updated_at.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      });
    });

    describe('pre-findOneAndUpdate', () => {
      it('should update audit.updated_at on findOneAndUpdate', async () => {
        const schedule = await ScheduleV2.create(createScheduleInput({ device_id: 'device_fau' }));

        await new Promise(resolve => setTimeout(resolve, 10));

        const updated = await ScheduleV2.findByIdAndUpdate(
          schedule._id,
          { $set: { notes: 'Updated via findOneAndUpdate' } },
          { new: true }
        );

        expect(updated?.notes).toBe('Updated via findOneAndUpdate');
        expect(updated?.audit.updated_at).toBeInstanceOf(Date);
      });
    });
  });

  // ==========================================================================
  // AUDIT DEFAULTS TESTS
  // ==========================================================================

  describe('Audit Defaults', () => {
    it('should use default created_at and updated_at when not provided', async () => {
      const before = new Date();

      const schedule = await ScheduleV2.create({
        device_id: 'device_audit_defaults',
        service_type: 'calibration',
        scheduled_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        audit: {
          created_by: 'test@example.com',
          updated_by: 'test@example.com',
        },
      });

      const after = new Date();

      // Defaults should have been applied
      expect(schedule.audit.created_at).toBeInstanceOf(Date);
      expect(schedule.audit.updated_at).toBeInstanceOf(Date);
      expect(schedule.audit.created_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(schedule.audit.created_at.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // ==========================================================================
  // BULK OPERATIONS TESTS
  // ==========================================================================

  describe('Bulk Operations', () => {
    it('should insert multiple schedules', async () => {
      const schedules = createScheduleInputs(5);
      const result = await ScheduleV2.insertMany(schedules);

      expect(result.length).toBe(5);
    });

    it('should create schedules for different devices', async () => {
      const schedules = [
        createScheduleInput({ device_id: 'bulk_device_1' }),
        createScheduleInput({ device_id: 'bulk_device_2' }),
        createScheduleInput({ device_id: 'bulk_device_3' }),
      ];

      const result = await ScheduleV2.insertMany(schedules);

      expect(result.length).toBe(3);
      expect(result.map(s => s.device_id)).toEqual(['bulk_device_1', 'bulk_device_2', 'bulk_device_3']);
    });
  });
});
