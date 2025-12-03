import dbConnect from '../lib/db';
import Device, { IDevice } from '../models/Device';
import mongoose from 'mongoose';

const ROOM_TYPES = ['Server Room', 'Conference Room', 'Office', 'Cafeteria', 'Lobby'];
const DEVICE_TYPES = ['temperature', 'humidity', 'occupancy', 'power'] as const;

async function seed() {
  await dbConnect();
  console.log('Connected to MongoDB');

  await Device.deleteMany({});
  console.log('Cleared devices collection');

  const devices: Partial<IDevice>[] = [];

  // Create specific Server Room device
  devices.push({
    _id: 'device_001',
    building_id: 'bldg_denver_hq',
    floor: 2,
    room_name: 'Server Room B',
    type: 'temperature',
    status: 'active',
    install_date: new Date('2024-01-15'),
    configuration: {
      threshold_warning: 80,
      threshold_critical: 95,
    },
  });

  // Create 49 random devices
  for (let i = 2; i <= 50; i++) {
    const type = DEVICE_TYPES[Math.floor(Math.random() * DEVICE_TYPES.length)];
    const room = ROOM_TYPES[Math.floor(Math.random() * ROOM_TYPES.length)];
    const floor = Math.floor(Math.random() * 5) + 1;
    
    devices.push({
      _id: `device_${i.toString().padStart(3, '0')}`,
      building_id: 'bldg_denver_hq',
      floor: floor,
      room_name: `${room} ${Math.floor(Math.random() * 100)}`,
      type: type,
      status:
        Math.random() > 0.95
          ? 'offline'
          : Math.random() > 0.9
          ? 'maintenance'
          : 'active',
      install_date: new Date(),
      configuration: {
        threshold_warning: type === 'temperature' ? 80 : 70,
        threshold_critical: type === 'temperature' ? 95 : 90,
      },
    });
  }

  await Device.insertMany(devices);
  console.log(`Seeded ${devices.length} devices`);

  await mongoose.disconnect();
  console.log('Disconnected');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
