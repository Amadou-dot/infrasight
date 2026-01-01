import { NextResponse } from 'next/server';
import { pusherServer } from '@/lib/pusher';
import ReadingV2, { type ReadingUnit } from '@/models/v2/ReadingV2';
import DeviceV2, { type DeviceType } from '@/models/v2/DeviceV2';
import dbConnect from '@/lib/db';

// Map device types to their corresponding reading units
const deviceTypeToUnit: Record<DeviceType, ReadingUnit> = {
  temperature: 'celsius',
  humidity: 'percent',
  occupancy: 'count',
  power: 'watts',
  co2: 'ppm',
  pressure: 'hpa',
  light: 'lux',
  motion: 'boolean',
  air_quality: 'ppm',
  water_flow: 'liters_per_minute',
  gas: 'ppm',
  vibration: 'raw',
  voltage: 'volts',
  current: 'amperes',
  energy: 'kilowatt_hours',
};

// Reusing the logic from scripts/simulate.ts but adapted for a single run
async function generateMockReadings() {
  await dbConnect();
  const devices = await DeviceV2.findActive({});
  const readings = [];
  const timestamp = new Date();

  // We need to maintain some state for the server room if we want it to drift
  // But in a serverless function, state is hard.
  // For now, we'll just randomize it around a high value to simulate the issue
  // Or we could fetch the last reading to continue the trend, but that's expensive.
  // Let's stick to the random logic for now, maybe slightly improved.

  for (const device of devices) {
    let value = 0;

    if (device._id === 'device_001') {
      // Server Room B - Overheating simulation
      // Random value between 65 and 105
      value = 65 + Math.random() * 40;
      value = parseFloat(value.toFixed(1));
    } else {
      switch (device.type) {
        case 'temperature':
          value = 70 + (Math.random() * 5 - 2.5);
          break;
        case 'humidity':
          value = 40 + (Math.random() * 10 - 5);
          break;
        case 'occupancy':
          value = Math.random() > 0.8 ? 1 : 0;
          break;
        case 'power':
          value = 100 + (Math.random() * 50 - 25);
          break;
      }
      value = parseFloat(value.toFixed(1));
    }

    readings.push({
      metadata: {
        device_id: device._id,
        type: device.type,
        unit: deviceTypeToUnit[device.type] || 'raw',
        source: 'simulation' as const,
      },
      timestamp: timestamp,
      value: value,
      quality: {
        is_valid: true,
        confidence_score: 0.95,
        is_anomaly: false,
      },
      processing: {
        raw_value: value,
        ingested_at: new Date(),
      },
    });
  }
  return readings;
}

export async function GET() {
  try {
    // 1. Generate mock data
    const newReadings = await generateMockReadings();

    // 2. Insert into DB (The "Cold" Store)
    await ReadingV2.bulkInsertReadings(newReadings);

    // 3. Trigger Real-time Update (The "Hot" Path)
    await pusherServer.trigger('InfraSight', 'new-readings', newReadings);

    return NextResponse.json({ success: true, count: newReadings.length });
  } catch (error) {
    console.error('Simulation error:', error);
    return NextResponse.json(
      { success: false, error: 'Simulation failed' },
      { status: 500 }
    );
  }
}
