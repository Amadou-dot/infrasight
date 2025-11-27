import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Device from '@/models/Device';

// Cache the metadata for 1 hour since it rarely changes
export const revalidate = 3600;

export async function GET() {
  await dbConnect();

  try {
    const [floors, rooms, types] = await Promise.all([
      Device.distinct('floor'),
      Device.distinct('room_name'),
      Device.distinct('type'),
    ]);

    // Only return floors that actually have devices (distinct already does this, but good to be sure)
    // Sort them for better UI
    const sortedFloors = floors.sort((a, b) => a - b);
    const sortedRooms = rooms.sort();
    const sortedTypes = types.sort();

    return NextResponse.json({
      floors: sortedFloors,
      rooms: sortedRooms,
      types: sortedTypes,
    });
  } catch (error) {
    console.error('Metadata fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch metadata' }, { status: 500 });
  }
}
