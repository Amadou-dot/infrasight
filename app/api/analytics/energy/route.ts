import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Reading from '@/models/Reading';

export async function GET(request: NextRequest) {
  await dbConnect();
  
  const searchParams = request.nextUrl.searchParams;
  const period = searchParams.get('period') || '24h';
  
  // Calculate start time
  const now = new Date();
  let startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default 24h
  
  if (period === '7d') {
    startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === '1h') {
    startTime = new Date(now.getTime() - 60 * 60 * 1000);
  }

  try {
    const data = await Reading.aggregate([
      {
        $match: {
          timestamp: { $gte: startTime },
          'metadata.type': 'power'
        }
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$timestamp',
              unit: 'minute',
              binSize: 10
            }
          },
          avgValue: { $avg: '$value' },
        }
      },
      {
        $sort: { _id: 1 }
      },
      {
        $project: {
          timestamp: '$_id',
          value: { $round: ['$avgValue', 2] },
          _id: 0
        }
      }
    ]);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Aggregation error:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
