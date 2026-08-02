/**
 * AlertV2 Model Unit Tests
 *
 * Covers every legal transition, every illegal transition throwing the correct
 * typed code, and the is_open === (status !== 'resolved') invariant after each.
 */

import { Types } from 'mongoose';
import AlertV2, { AlertTransitionError } from '@/models/v2/AlertV2';
import { createAlertInput, resetCounters } from '../../setup/factories';

/** The one invariant that keeps the partial unique index correct. */
function assertIsOpenInvariant(doc: { status: string; is_open: boolean }) {
  expect(doc.is_open).toBe(doc.status !== 'resolved');
}

describe('AlertV2 Model', () => {
  beforeEach(() => {
    resetCounters();
  });

  describe('AlertTransitionError', () => {
    it('should carry name and code', () => {
      const error = new AlertTransitionError('ALREADY_RESOLVED', 'Already resolved');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AlertTransitionError');
      expect(error.code).toBe('ALREADY_RESOLVED');
    });
  });

  describe('document creation', () => {
    it('should create a firing alert satisfying the is_open invariant', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

      assertIsOpenInvariant(alert);
      expect(alert.audit.created_by).toBe('system');
    });

    it('should reject an unknown status', async () => {
      await expect(
        AlertV2.create(createAlertInput({ status: 'exploded' as never }))
      ).rejects.toThrow();
    });
  });

  describe('deduplication index', () => {
    it('should reject a second open episode for the same rule and device', async () => {
      await AlertV2.init(); // ensure indexes are built before asserting on them

      const rule_id = new Types.ObjectId();
      await AlertV2.create(createAlertInput({ rule_id, device_id: 'device_001', is_open: true }));

      await expect(
        AlertV2.create(createAlertInput({ rule_id, device_id: 'device_001', is_open: true }))
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('should allow unlimited resolved episodes for the same rule and device', async () => {
      await AlertV2.init();

      const rule_id = new Types.ObjectId();
      await AlertV2.create(
        createAlertInput({ rule_id, device_id: 'device_002', status: 'resolved', is_open: false })
      );
      await AlertV2.create(
        createAlertInput({ rule_id, device_id: 'device_002', status: 'resolved', is_open: false })
      );

      const count = await AlertV2.countDocuments({ rule_id, device_id: 'device_002' });
      expect(count).toBe(2);
    });
  });

  describe('acknowledge', () => {
    it('should move firing to acknowledged and leave is_open true', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

      const acked = await AlertV2.acknowledge(String(alert._id), 'user_admin');

      expect(acked!.status).toBe('acknowledged');
      expect(acked!.audit.acknowledged_by).toBe('user_admin');
      expect(acked!.audit.acknowledged_at).toBeInstanceOf(Date);
      assertIsOpenInvariant(acked!);
    });

    it('should throw ALREADY_ACKNOWLEDGED when already acknowledged', async () => {
      const alert = await AlertV2.create(
        createAlertInput({ status: 'acknowledged', is_open: true })
      );

      await expect(AlertV2.acknowledge(String(alert._id), 'user_admin')).rejects.toMatchObject({
        name: 'AlertTransitionError',
        code: 'ALREADY_ACKNOWLEDGED',
      });
    });

    it('should throw ALREADY_RESOLVED when resolved', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      await expect(AlertV2.acknowledge(String(alert._id), 'user_admin')).rejects.toMatchObject({
        code: 'ALREADY_RESOLVED',
      });
    });

    it('should throw NOT_YET_FIRING when pending', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'pending', is_open: true }));

      await expect(AlertV2.acknowledge(String(alert._id), 'user_admin')).rejects.toMatchObject({
        code: 'NOT_YET_FIRING',
      });
    });

    it('should return null for an unknown id', async () => {
      const result = await AlertV2.acknowledge('507f1f77bcf86cd799439011', 'user_admin');
      expect(result).toBeNull();
    });
  });

  describe('resolve', () => {
    it('should resolve a firing alert and flip is_open to false', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

      const resolved = await AlertV2.resolve(String(alert._id), 'user_admin');

      expect(resolved!.status).toBe('resolved');
      expect(resolved!.audit.resolution).toBe('manual');
      expect(resolved!.audit.resolved_by).toBe('user_admin');
      assertIsOpenInvariant(resolved!);
    });

    it('should resolve an acknowledged alert', async () => {
      const alert = await AlertV2.create(
        createAlertInput({ status: 'acknowledged', is_open: true })
      );

      const resolved = await AlertV2.resolve(String(alert._id), 'user_admin');

      expect(resolved!.status).toBe('resolved');
      assertIsOpenInvariant(resolved!);
    });

    it('should record a non-default resolution', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

      const resolved = await AlertV2.resolve(String(alert._id), 'system', 'stale');

      expect(resolved!.audit.resolution).toBe('stale');
    });

    it('should throw ALREADY_RESOLVED when already resolved', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      await expect(AlertV2.resolve(String(alert._id), 'user_admin')).rejects.toMatchObject({
        code: 'ALREADY_RESOLVED',
      });
    });

    it('should throw NOT_YET_FIRING when pending', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'pending', is_open: true }));

      await expect(AlertV2.resolve(String(alert._id), 'user_admin')).rejects.toMatchObject({
        code: 'NOT_YET_FIRING',
      });
    });

    it('should return null for an unknown id', async () => {
      const result = await AlertV2.resolve('507f1f77bcf86cd799439011', 'user_admin');
      expect(result).toBeNull();
    });
  });
});
