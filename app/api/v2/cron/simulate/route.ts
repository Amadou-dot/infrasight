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

    // 2. Insert into DB (The "Cold" Store)
    await ReadingV2.bulkInsertReadings(newReadings);

    // 3. Trigger Real-time Update (The "Hot" Path)
    try {
      await pusherServer.trigger('InfraSight', 'new-readings', newReadings);
    } catch (pusherError) {
      logger.error('Pusher trigger failed after successful DB write', {
        error: pusherError instanceof Error ? pusherError.message : String(pusherError),
        readingsCount: newReadings.length,
      });
    }

    // 4. Evaluate alert rules against the readings we just wrote.
    await safeEvaluateReadings(newReadings, devices);

    // 5. Sweep alerts whose device has stopped reporting. Cron path only — the
    //    reporting set is the devices we just emitted for, so this needs no
    //    device query of its own.
    await safeSweepStaleAlerts(new Set(devices.map(device => String(device._id))));

    // Count anomalies for response
    const anomalyCount = newReadings.filter(r => r.quality?.is_anomaly === true).length;

    return NextResponse.json({
      success: true,
      count: newReadings.length,
      anomalies: anomalyCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Simulation error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Simulation failed' }, { status: 500 });
  }
}
