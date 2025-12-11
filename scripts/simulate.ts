import dbConnect from '../lib/db';
import Device from '../models/Device';
import Reading from '../models/Reading';
import _mongoose from 'mongoose';

// Simulation state for the overheating server room
let serverRoomTemp = 70;

async function generateReadings() {
  try {
    const devices = await Device.find({});
    const readings = [];
    const timestamp = new Date();

    for (const device of devices) {
      let value = 0;

      if (device._id === 'device_001') {
        // Server Room B - Slowly overheat
        // Increase by 0.5 to 1.5 degrees, but sometimes cool down a bit to be realistic
        // But generally trend upwards
        const change = (Math.random() * 2) - 0.5; 
        serverRoomTemp += change;
        
        // Cap it so it doesn't go to infinity during long runs, but high enough to trigger alerts
        if (serverRoomTemp > 110) {serverRoomTemp = 105;} 
        if (serverRoomTemp < 60) {serverRoomTemp = 65;}

        value = parseFloat(serverRoomTemp.toFixed(1));
      } else {
        // Random values for other devices
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

    await Reading.insertMany(readings);
    console.log(`Inserted ${readings.length} readings at ${timestamp.toISOString()}`);
  } catch (error) {
    console.error('Error generating readings:', error);
  }
}

async function startSimulation() {
  await dbConnect();
  console.log('Connected to MongoDB. Starting simulation...');

  // Run immediately
  await generateReadings();

  // Then every 5 seconds
  setInterval(generateReadings, 5000);
}

startSimulation().catch((err) => {
  console.error(err);
  process.exit(1);
});
