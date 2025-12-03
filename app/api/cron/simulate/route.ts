import { NextResponse } from 'next/server';
import { pusherServer } from '@/lib/pusher';
import Reading from '@/models/Reading';
import Device from '@/models/Device';
import dbConnect from '@/lib/db';

// Reusing the logic from scripts/simulate.ts but adapted for a single run
async function generateMockReadings() {
  await dbConnect();
  const devices = await Device.find({});
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
      },
      timestamp: timestamp,
      value: value,
    });
  }
  return readings;
}

export async function GET() {
  try {
    // 1. Generate mock data
    const newReadings = await generateMockReadings();

    // 2. Insert into DB (The "Cold" Store)
    await Reading.insertMany(newReadings);

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
