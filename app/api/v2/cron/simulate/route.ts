import crypto from 'crypto';
import dbConnect from '@/lib/db';
import { pusherServer } from '@/lib/pusher';
import DeviceV2, { type IDeviceV2 } from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/monitoring';
import { safeEvaluateReadings, safeSweepStaleAlerts } from '@/lib/alerting';
import {
  generateSimulatedReadings,
  type SimulatedDevice,
} from '@/lib/simulation/readings';

type CronDevice = SimulatedDevice & Pick<IDeviceV2, 'metadata'>;

// ============================================================================
// API ROUTE HANDLER
// ============================================================================

export async function GET(request: NextRequest) {
  // Read SEED_SECRET at request time so rotated values are picked up
  const seedSecret = process.env.SEED_SECRET;

  // Require SEED_SECRET — fail-closed if not configured
  if (!seedSecret) 
    return NextResponse.json(
      { success: false, error: 'SEED_SECRET is not configured' },
      { status: 503 }
    );
  

  const authHeader = request.headers.get('authorization');
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (
    !provided ||
    provided.length !== seedSecret.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(seedSecret))
  ) 
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  

  try {
    await dbConnect();

    const devices = await DeviceV2.findActive()
      .select({ _id: 1, type: 1, location: 1, 'metadata.tags': 1 })
      .lean<CronDevice[]>();

    // 1. Generate mock data
    const newReadings = generateSimulatedReadings(devices);

    if (newReadings.length === 0)
      return NextResponse.json(
        {
          success: false,
          error: 'No devices found. Run `pnpm seed` to create V2 devices.',
        },
        { status: 404 }
      );

    // 2. Insert into DB (The "Cold" Store). bulkInsertReadings runs
    //    insertMany with { ordered: false }: documents that fail validation
    //    are silently skipped and it resolves with only the readings that
    //    were actually written, without throwing. Capture that subset — it
    //    is the only thing downstream steps may treat as having happened.
    const insertedReadings = await ReadingV2.bulkInsertReadings(newReadings);
    const rejectedCount = newReadings.length - insertedReadings.length;

    // 3. Trigger Real-time Update (The "Hot" Path). Broadcast only what was
    //    actually written — a rejected reading must never appear on a client
    //    tile as though it were stored. toObject() strips the Mongoose
    //    document wrapper; versionKey: false keeps `__v` out of a payload
    //    that is already sized against Pusher's 10 KB cap.
    try {
      await pusherServer.trigger(
        'InfraSight',
        'new-readings',
        insertedReadings.map(r => r.toObject({ versionKey: false }))
      );
    } catch (pusherError) {
      logger.error('Pusher trigger failed after successful DB write', {
        error: pusherError instanceof Error ? pusherError.message : String(pusherError),
        readingsCount: insertedReadings.length,
      });
    }

    // 4. Evaluate alert rules against the readings that actually persisted.
    //    A reading bulkInsertReadings rejected doesn't exist in the DB, so it
    //    must never be allowed to fire or resolve an alert.
    const evaluation = await safeEvaluateReadings(insertedReadings, devices);

    // An alert firing (or auto-resolving) is a domain event in its own right;
    // nothing else in this handler logs it.
    if (evaluation.fired.length || evaluation.resolved.length) {
      const affected = [...evaluation.fired, ...evaluation.resolved];
      logger.info('Alert rules fired or resolved during simulation', {
        fired: evaluation.fired.length,
        resolved: evaluation.resolved.length,
        ruleIds: [...new Set(affected.map(a => a.rule_id))],
        deviceIds: [...new Set(affected.map(a => a.device_id))],
      });
    }

    // 5. Sweep alerts whose device has stopped reporting. Cron path only — the
    //    reporting set is the devices we just emitted for, so this needs no
    //    device query of its own.
    await safeSweepStaleAlerts(new Set(devices.map(device => String(device._id))));

    // Count anomalies among the readings that actually persisted. One that
    // was rejected at insert time was never passed to safeEvaluateReadings
    // above and doesn't exist in the DB, so it must not inflate this count.
    const anomalyCount = insertedReadings.filter(r => r.quality.is_anomaly === true).length;

    return NextResponse.json({
      success: true,
      count: insertedReadings.length,
      rejected: rejectedCount,
      anomalies: anomalyCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Simulation error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Simulation failed' }, { status: 500 });
  }
}
