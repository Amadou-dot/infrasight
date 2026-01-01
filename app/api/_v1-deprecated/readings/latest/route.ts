import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Reading from '@/models/Reading';

export async function GET() {
  await dbConnect();
  try {
    const latestReadings = await Reading.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$metadata.device_id',
          value: { $first: '$value' },
          timestamp: { $first: '$timestamp' },
          type: { $first: '$metadata.type' }
        }
      }
    ]);
    return NextResponse.json(latestReadings);
  } catch (error) {
    console.error('Latest readings error:', error);
    return NextResponse.json({ error: 'Failed to fetch latest readings' }, { status: 500 });
  }
}
