import dbConnect from '../../lib/db';
import DeviceV2 from '../../models/v2/DeviceV2';
import ReadingV2 from '../../models/v2/ReadingV2';
import {
  generateSimulatedReadings,
  type SimulatedDevice,
} from '../../lib/simulation/readings';

async function generateReadings() {
  try {
    // Fetch all active V2 devices
    const timestamp = new Date();
    const devices = await DeviceV2.findActive()
      .select({ _id: 1, type: 1, location: 1 })
      .lean<SimulatedDevice[]>();
    const readings = generateSimulatedReadings(devices, timestamp);

    if (readings.length > 0) {
      await ReadingV2.insertMany(readings);

      // Count anomalies for logging
      const anomalyCount = readings.filter(r => r.quality?.is_anomaly === true).length;
      console.log(
        `[${timestamp.toISOString()}] Inserted ${readings.length} readings (${anomalyCount} anomalies)`
      );
    } else console.log('No devices found. Run `pnpm seed` to create V2 devices.');
  } catch (error) {
    console.error('Error generating readings:', error);
  }
}

async function startSimulation() {
  await dbConnect();
  console.log('🚀 Connected to MongoDB. Starting V2 simulation...');
  console.log('   Generating readings every 5 seconds. Press Ctrl+C to stop.\n');

  // Run immediately
  await generateReadings();

  // Then every 5 seconds
  setInterval(generateReadings, 5000);
}

startSimulation().catch(err => {
  console.error(err);
  process.exit(1);
});
