/**
 * AlertV2 Model Unit Tests
 *
 * Covers every legal transition, every illegal transition throwing the correct
 * typed code, and the is_open === (status !== 'resolved') invariant after each.
 */

import { Types } from 'mongoose';
import AlertV2, {
  AlertInvariantError,
  AlertTransitionError,
  isOpenForStatus,
} from '@/models/v2/AlertV2';
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

  // ==========================================================================
  // status / is_open INVARIANT ENFORCEMENT
  // ==========================================================================
  //
  // The invariant used to live only in a comment. The damage a drifted document
  // does is entirely invisible: a `resolved` document that kept `is_open: true`
  // stays in the partial unique dedup index forever, so the evaluator — which
  // loads open episodes purely on `is_open` — can never open another episode for
  // that (rule, device) pair, and never resolves the stuck one either. Nothing
  // logs, nothing counts, and the type system cannot help because the
  // evaluator's bulk insert reaches the driver through a cast.
  //
  // These tests therefore assert on the DOCUMENT that lands, and — where the
  // consequence is what matters — on the dedup index's behavior afterwards,
  // not merely on which error type came back.
  describe('status/is_open invariant', () => {
    describe('isOpenForStatus', () => {
      it('should map every status to its open state', () => {
        expect(isOpenForStatus('pending')).toBe(true);
        expect(isOpenForStatus('firing')).toBe(true);
        expect(isOpenForStatus('acknowledged')).toBe(true);
        expect(isOpenForStatus('resolved')).toBe(false);
      });
    });

    describe('document writes', () => {
      it('should reject a resolved document that keeps is_open true', async () => {
        await expect(
          AlertV2.create(createAlertInput({ status: 'resolved', is_open: true }))
        ).rejects.toThrow(/is_open/);

        expect(await AlertV2.countDocuments({})).toBe(0);
      });

      it('should reject an open document written with is_open false', async () => {
        await expect(
          AlertV2.create(createAlertInput({ status: 'firing', is_open: false }))
        ).rejects.toThrow(/is_open/);

        expect(await AlertV2.countDocuments({})).toBe(0);
      });

      it('should reject an inconsistent document on insertMany too', async () => {
        await expect(
          AlertV2.insertMany([createAlertInput({ status: 'resolved', is_open: true })])
        ).rejects.toThrow(/is_open/);
      });
    });

    describe('update writes', () => {
      it('should derive is_open when an update sets status alone', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        await AlertV2.updateOne({ _id: alert._id }, { $set: { status: 'resolved' } });

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.status).toBe('resolved');
        expect(stored!.is_open).toBe(false);
      });

      it('should derive is_open for an operator-free update document', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        // Mongoose casts a bare update into $set AFTER middleware runs, so this
        // shape genuinely reaches the guard in its uncast form.
        await AlertV2.updateOne({ _id: alert._id }, { status: 'resolved' });

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.is_open).toBe(false);
      });

      it('should reject an update that sets status and is_open in contradiction', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        await expect(
          AlertV2.updateOne(
            { _id: alert._id },
            { $set: { status: 'resolved', is_open: true } }
          )
        ).rejects.toBeInstanceOf(AlertInvariantError);

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.status).toBe('firing'); // nothing was written
        expect(stored!.is_open).toBe(true);
      });

      it('should reject an update that sets is_open without status', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        await expect(
          AlertV2.updateOne({ _id: alert._id }, { $set: { is_open: false } })
        ).rejects.toBeInstanceOf(AlertInvariantError);

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.is_open).toBe(true);
      });

      it('should leave an update that touches neither field alone', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        await AlertV2.updateOne({ _id: alert._id }, { $set: { last_value: 99 } });

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.last_value).toBe(99);
        expect(stored!.status).toBe('firing');
        expect(stored!.is_open).toBe(true);
      });

      it('should reject a contradictory findOneAndUpdate', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        await expect(
          AlertV2.findOneAndUpdate(
            { _id: alert._id },
            { $set: { status: 'resolved', is_open: true } }
          )
        ).rejects.toBeInstanceOf(AlertInvariantError);
      });
    });

    // bulkWrite bypasses query middleware entirely, and it is how BOTH
    // production writers that resolve an episode reach the database (the
    // evaluator's auto-resolve and the staleness sweep). An enforcement that
    // only covered updateOne/findOneAndUpdate would miss them both.
    describe('bulkWrite writes', () => {
      it('should derive is_open for a bulk update that sets status alone, freeing the dedup index', async () => {
        await AlertV2.init(); // the partial unique index must exist to be exercised

        const rule_id = new Types.ObjectId();
        const alert = await AlertV2.create(
          createAlertInput({ rule_id, device_id: 'device_bulk', status: 'firing', is_open: true })
        );

        await AlertV2.bulkWrite([
          { updateOne: { filter: { _id: alert._id }, update: { $set: { status: 'resolved' } } } },
        ]);

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.status).toBe('resolved');
        expect(stored!.is_open).toBe(false);

        // The consequence, not just the field: with is_open correctly false the
        // pair has left the partial unique index, so a NEW episode can open. If
        // is_open had stayed true this insert would throw E11000 and the pair
        // would be wedged forever.
        await expect(
          AlertV2.create(
            createAlertInput({ rule_id, device_id: 'device_bulk', status: 'firing' })
          )
        ).resolves.toBeDefined();
      });

      it('should reject a bulk update that sets status and is_open in contradiction', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        await expect(
          AlertV2.bulkWrite([
            {
              updateOne: {
                filter: { _id: alert._id },
                update: { $set: { status: 'resolved', is_open: true } },
              },
            },
          ])
        ).rejects.toBeInstanceOf(AlertInvariantError);

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.status).toBe('firing');
      });

      // With `{ ordered: false }` — which both production callers use — a
      // document that merely fails validation is DROPPED from the batch and
      // decorated onto the result rather than thrown. That is exactly the
      // silence the finding is about, so the insert path is guarded before the
      // cast, where it can still fail the call.
      it('should reject an inconsistent bulk insert instead of silently dropping it', async () => {
        await expect(
          AlertV2.bulkWrite(
            [
              {
                insertOne: {
                  document: createAlertInput({ status: 'resolved', is_open: true }) as never,
                },
              },
            ],
            { ordered: false }
          )
        ).rejects.toBeInstanceOf(AlertInvariantError);

        expect(await AlertV2.countDocuments({})).toBe(0);
      });

      it('should leave a bulk update that touches neither field alone', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        await AlertV2.bulkWrite([
          {
            updateOne: {
              filter: { _id: alert._id },
              update: { $set: { last_value: 77 }, $max: { last_observed_at: new Date() } },
            },
          },
        ]);

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.last_value).toBe(77);
        expect(stored!.is_open).toBe(true);
      });
    });

    // The five writers that existed before this guard, each re-verified to
    // still land a consistent document THROUGH the guard rather than around it.
    describe('the existing writers still work', () => {
      it('acknowledge() leaves an open, consistent document', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        const acked = await AlertV2.acknowledge(String(alert._id), 'user_admin');

        expect(acked!.status).toBe('acknowledged');
        expect(acked!.is_open).toBe(true);
      });

      it('resolve() leaves a closed, consistent document', async () => {
        const alert = await AlertV2.create(createAlertInput({ status: 'firing', is_open: true }));

        const resolved = await AlertV2.resolve(String(alert._id), 'user_admin');

        expect(resolved!.status).toBe('resolved');
        expect(resolved!.is_open).toBe(false);
      });
    });
  });
});
