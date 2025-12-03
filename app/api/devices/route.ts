import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Device from '@/models/Device';

export async function GET(request: NextRequest) {
  await dbConnect();

  const searchParams = request.nextUrl.searchParams;
  const floor = searchParams.get('floor');
  const status = searchParams.get('status');
  const sort = searchParams.get('sort'); // e.g. 'room_name:asc'

  // Validate floor parameter
  if (floor && (isNaN(parseInt(floor)) || parseInt(floor) < 1)) {
    return NextResponse.json(
      { error: 'Invalid floor parameter' },
      { status: 400 }
    );
  }

  // Validate status parameter
  const validStatuses = ['active', 'maintenance', 'offline'];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: 'Invalid status parameter. Must be: active, maintenance, or offline' },
      { status: 400 }
    );
  }

  const query: Record<string, string | number> = {};
  if (floor) query.floor = parseInt(floor);
  if (status) query.status = status;

  let sortOption: Record<string, 1 | -1> = {};
  if (sort) {
    const [field, order] = sort.split(':');
    sortOption[field] = order === 'desc' ? -1 : 1;
  } else {
    sortOption = { room_name: 1 };
  }

  try {
    const devices = await Device.find(query).sort(sortOption);
    return NextResponse.json(devices);
  } catch (error) {
    console.error('Error fetching devices:', error);
    return NextResponse.json(
      { error: 'Failed to fetch devices' },
      { status: 500 }
    );
  }
}
