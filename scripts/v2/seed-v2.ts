#!/usr/bin/env npx tsx
/**
 * V2 Database Seed Script
 *
 * Seeds the V2 collections (devices_v2, readings_v2) with test data.
 * Run with: pnpm tsx scripts/v2/seed-v2.ts
 *
 * Prerequisites:
 * - MONGODB_URI environment variable set
 */

import mongoose from 'mongoose';
import DeviceV2 from '../../models/v2/DeviceV2';
import ReadingV2 from '../../models/v2/ReadingV2';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

// Assert MONGODB_URI is string after check
const mongoUri: string = MONGODB_URI;

// ============================================================================
// Configuration
// ============================================================================

const NUM_DEVICES = 500;
const READINGS_PER_DEVICE = 25;

// ============================================================================
// Data Generators
// ============================================================================

const deviceTypes = [
  'temperature',
  'humidity',
  'occupancy',
  'power',
  'co2',
  'pressure',
  'light',
  'motion',
  'air_quality',
  'water_flow',
  'gas',
  'vibration',
  'voltage',
  'current',
  'energy',
] as const;

const manufacturers = ['SensorCorp', 'IoTech', 'SmartSense', 'EnviroTech', 'DataLogix'];
const departments = ['Engineering', 'Operations', 'Facilities', 'Research', 'Sales'];
const buildings = ['HQ', 'Building-A', 'Building-B', 'Warehouse', 'Lab'];
const rooms = ['Conference Room', 'Open Office', 'Server Room', 'Break Room', 'Reception', 'Lab Area'];
const dataClassifications = ['public', 'internal', 'confidential', 'restricted'] as const;
const statuses = ['active', 'maintenance', 'offline', 'error'] as const;

const unitsByType: Record<string, string> = {
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

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function generateDeviceId(index: number): string {
  return `device_v2_${String(index + 1).padStart(4, '0')}`;
}

function generateSerialNumber(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let serial = 'SN-';
  for (let i = 0; i < 10; i++) 
    serial += chars.charAt(Math.floor(Math.random() * chars.length));
  
  return serial;
}

function generateDevice(index: number): unknown {
  const type = randomChoice(deviceTypes);
  const status = randomChoice(statuses);
  const now = new Date();
  const createdAt = new Date(now.getTime() - randomInt(30, 365) * 24 * 60 * 60 * 1000);

  return {
    _id: generateDeviceId(index),
    serial_number: generateSerialNumber(),
    manufacturer: randomChoice(manufacturers),
    device_model: `${type.toUpperCase()}-${randomInt(1000, 9999)}`,
    firmware_version: `${randomInt(1, 3)}.${randomInt(0, 9)}.${randomInt(0, 9)}`,
    type,
    configuration: {
      threshold_warning: type === 'temperature' ? 25 : randomInt(50, 80),
      threshold_critical: type === 'temperature' ? 30 : randomInt(80, 100),
      sampling_interval: randomChoice([30, 60, 120, 300]),
      calibration_date: new Date(now.getTime() - randomInt(0, 180) * 24 * 60 * 60 * 1000),
      calibration_offset: randomFloat(-2, 2, 3),
    },
    location: {
      building_id: randomChoice(buildings),
      floor: randomInt(1, 5),
      room_name: randomChoice(rooms),
      coordinates: {
        x: randomFloat(0, 100),
        y: randomFloat(0, 100),
      },
      zone: `Zone-${randomChoice(['A', 'B', 'C', 'D'])}`,
    },
    metadata: {
      tags: [
        type,
        `floor-${randomInt(1, 5)}`,
        ...(Math.random() > 0.5 ? ['critical'] : []),
        ...(Math.random() > 0.7 ? ['monitored'] : []),
      ],
      department: randomChoice(departments),
      cost_center: `CC-${randomInt(1000, 9999)}`,
      warranty_expiry: new Date(now.getTime() + randomInt(30, 730) * 24 * 60 * 60 * 1000),
      last_maintenance: new Date(now.getTime() - randomInt(0, 90) * 24 * 60 * 60 * 1000),
      next_maintenance: new Date(now.getTime() + randomInt(30, 180) * 24 * 60 * 60 * 1000),
    },
    audit: {
      created_at: createdAt,
      created_by: 'seed-script',
      updated_at: createdAt,
      updated_by: 'seed-script',
    },
    health: {
      last_seen: new Date(now.getTime() - randomInt(0, status === 'offline' ? 24 * 60 : 60) * 60 * 1000),
      uptime_percentage: status === 'active' ? randomFloat(95, 99.9) : randomFloat(50, 95),
      error_count: status === 'active' ? randomInt(0, 5) : randomInt(5, 50),
      battery_level: Math.random() > 0.3 ? randomInt(10, 100) : undefined,
      signal_strength: randomInt(-90, -30),
      // Add last_error for devices with error status or high error counts
      ...(status === 'error' || (status !== 'active' && Math.random() > 0.5) ? {
        last_error: {
          timestamp: new Date(now.getTime() - randomInt(0, 48) * 60 * 60 * 1000),
          code: randomChoice(['SENSOR_TIMEOUT', 'CALIBRATION_DRIFT', 'LOW_SIGNAL', 'BATTERY_CRITICAL', 'COMM_FAILURE', 'DATA_CORRUPTION']),
          message: randomChoice([
            'Sensor failed to respond within timeout period',
            'Calibration values have drifted beyond acceptable range',
            'Signal strength below minimum threshold',
            'Battery level critically low, immediate replacement required',
            'Communication failure with gateway device',
            'Data integrity check failed, possible sensor malfunction',
          ]),
        },
      } : {}),
    },
    status,
    status_reason: status !== 'active' ? `${status} since ${new Date().toISOString()}` : undefined,
    compliance: {
      requires_encryption: Math.random() > 0.7,
      data_classification: randomChoice(dataClassifications),
      retention_days: randomChoice([30, 90, 180, 365]),
    },
  };
}

function generateReading(deviceId: string, type: string, timestamp: Date): unknown {
  const unit = unitsByType[type] || 'raw';
  let value: number;

  // Generate realistic values based on type
  switch (type) {
    case 'temperature':
      value = randomFloat(18, 28);
      break;
    case 'humidity':
      value = randomFloat(30, 70);
      break;
    case 'occupancy':
      value = randomInt(0, 50);
      break;
    case 'power':
      value = randomFloat(100, 5000);
      break;
    case 'co2':
      value = randomInt(400, 1200);
      break;
    case 'pressure':
      value = randomFloat(1000, 1030);
      break;
    case 'light':
      value = randomInt(100, 1000);
      break;
    case 'motion':
      value = Math.random() > 0.7 ? 1 : 0;
      break;
    case 'air_quality':
      value = randomInt(0, 300);
      break;
    case 'water_flow':
      value = randomFloat(0.5, 50);
      break;
    case 'gas':
      value = randomInt(0, 500);
      break;
    case 'vibration':
      value = randomFloat(0, 10);
      break;
    case 'voltage':
      value = randomFloat(110, 240);
      break;
    case 'current':
      value = randomFloat(0.1, 15);
      break;
    case 'energy':
      value = randomFloat(0, 100);
      break;
    default:
      value = randomFloat(0, 100);
  }

  const isAnomaly = Math.random() > 0.95; // 5% anomaly rate
  const confidenceScore = randomFloat(0.85, 1.0);

  return {
    metadata: {
      device_id: deviceId,
      type,
      unit,
      source: 'simulation',
    },
    timestamp,
    value,
    quality: {
      is_valid: Math.random() > 0.02, // 2% invalid
      confidence_score: confidenceScore,
      is_anomaly: isAnomaly,
      anomaly_score: isAnomaly ? randomFloat(0.5, 1.0) : randomFloat(0, 0.3),
      validation_flags: [],
    },
    context: {
      battery_level: randomInt(20, 100),
      signal_strength: randomInt(-90, -30),
    },
    processing: {
      raw_value: value + randomFloat(-0.5, 0.5),
      calibration_offset: randomFloat(-0.5, 0.5),
      ingested_at: new Date(),
    },
  };
}

// ============================================================================
// Main Seed Function
// ============================================================================

async function seed(): Promise<void> {
  console.log('🌱 Starting V2 Database Seed\n');

  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Clear existing V2 data (optional - comment out to append)
    console.log('🧹 Clearing existing V2 data...');
    await DeviceV2.deleteMany({});
    await ReadingV2.deleteMany({});
    console.log('✅ Cleared existing data\n');

    // Generate and insert devices
    console.log(`📱 Generating ${NUM_DEVICES} devices...`);
    const devices = [];
    for (let i = 0; i < NUM_DEVICES; i++) 
      devices.push(generateDevice(i));
    
    await DeviceV2.insertMany(devices);
    console.log(`✅ Inserted ${NUM_DEVICES} devices\n`);

    // Generate and insert readings
    console.log(`📊 Generating readings for each device...`);
    const now = Date.now();
    let totalReadings = 0;

    for (const device of devices) {
      const deviceDoc = device as { _id: string; type: string };
      const readings = [];
      
      // Generate readings over the past 7 days
      for (let i = 0; i < READINGS_PER_DEVICE; i++) {
        const timestamp = new Date(now - i * 60 * 60 * 1000); // 1 hour apart
        readings.push(generateReading(deviceDoc._id, deviceDoc.type, timestamp));
      }

      await ReadingV2.insertMany(readings);
      totalReadings += readings.length;
      process.stdout.write(`\r  Progress: ${totalReadings} readings inserted`);
    }

    console.log(`\n✅ Inserted ${totalReadings} readings total\n`);

    // Summary
    console.log('='.repeat(50));
    console.log('📋 Seed Summary');
    console.log('='.repeat(50));
    console.log(`  Devices: ${NUM_DEVICES}`);
    console.log(`  Readings: ${totalReadings}`);
    console.log(`  Readings per device: ${READINGS_PER_DEVICE}`);
    console.log(`  Device types: ${deviceTypes.length}`);
    console.log(`  Time range: 7 days`);
    console.log('='.repeat(50));

    console.log('\n✅ Seed completed successfully!');
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
  }
}

// Run seed
seed();
