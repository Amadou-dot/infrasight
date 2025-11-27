import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Device from '@/models/Device';

export async function GET(request: NextRequest) {
  await dbConnect();

  const searchParams = request.nextUrl.searchParams;
  const floor = searchParams.get('floor');
  const status = searchParams.get('status');
  const sort = searchParams.get('sort'); // e.g. 'room_name:asc'

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
    return NextResponse.json(
      { error: 'Failed to fetch devices' },
      { status: 500 }
    );
  }
}
