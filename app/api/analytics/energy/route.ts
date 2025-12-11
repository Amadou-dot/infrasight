import { type NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Reading from '@/models/Reading';

export async function GET(request: NextRequest) {
  await dbConnect();
  
  const searchParams = request.nextUrl.searchParams;
  const period = searchParams.get('period') || '24h';
  
  const floor = searchParams.get('floor');

  // Validate period parameter
  const validPeriods = ['1h', '24h', '7d'];
  if (!validPeriods.includes(period)) {
    return NextResponse.json(
      { error: 'Invalid period parameter. Must be: 1h, 24h, or 7d' },
      { status: 400 }
    );
  }

  // Validate floor parameter
  if (floor && floor !== 'all' && (isNaN(parseInt(floor)) || parseInt(floor) < 1)) {
    return NextResponse.json(
      { error: 'Invalid floor parameter' },
      { status: 400 }
    );
  }

  // Calculate start time
  const now = new Date();
  let startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default 24h

  if (period === '7d') {
    startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === '1h') {
    startTime = new Date(now.getTime() - 60 * 60 * 1000);
  }

  interface MatchStage {
    timestamp: { $gte: Date };
    'metadata.type': string;
    'metadata.device_id'?: { $in: string[] };
  }

  const matchStage: MatchStage = {
    timestamp: { $gte: startTime },
    'metadata.type': 'power',
  };

  // If filtering by floor, we need to look up devices on that floor first
  // This is a bit complex with the current schema because readings don't have floor info directly.
  // We would need to join or fetch devices first.
  // For simplicity/performance in this specific schema, let's fetch device IDs for the floor first.
  if (floor && floor !== 'all') {
    const deviceIds = await import('@/models/Device').then(m =>
      m.default.find({ floor: parseInt(floor) }).distinct('_id')
    );
    matchStage['metadata.device_id'] = { $in: deviceIds };
  }

  try {
    const data = await Reading.aggregate([
      {
        $match: matchStage,
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$timestamp',
              unit: 'minute',
              binSize: 10,
            },
          },
          avgValue: { $avg: '$value' },
        },
      },
      {
        $sort: { _id: 1 },
      },
      {
        $project: {
          timestamp: '$_id',
          value: { $round: ['$avgValue', 2] },
          _id: 0,
        },
      },
    ]);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Aggregation error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}
