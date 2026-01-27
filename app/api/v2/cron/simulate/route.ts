import dbConnect from '@/lib/db';
import { pusherServer } from '@/lib/pusher';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2, { type ReadingType, type ReadingUnit } from '@/models/v2/ReadingV2';
import { NextResponse } from 'next/server';

// ============================================================================
// VALUE GENERATORS BY DEVICE TYPE
// ============================================================================

interface GeneratedReading {
  value: number;
  unit: ReadingUnit;
  isAnomaly: boolean;
}

/**
 * Generate realistic values for each device type
 */
function generateValueForType(type: ReadingType): GeneratedReading {
  // 5% chance of anomaly
  const isAnomaly = Math.random() < 0.05;

  let value: number;
  let unit: ReadingUnit;

  switch (type) {
    case 'temperature':
      // Normal: 18-28°C, Anomaly: 30-40°C or 5-15°C
      value = isAnomaly
        ? Math.random() > 0.5
          ? 30 + Math.random() * 10
          : 5 + Math.random() * 10
        : 18 + Math.random() * 10;
      unit = 'celsius';
      break;

    case 'humidity':
      // Normal: 30-70%, Anomaly: 10-20% or 80-95%
      value = isAnomaly
        ? Math.random() > 0.5
          ? 80 + Math.random() * 15
          : 10 + Math.random() * 10
        : 30 + Math.random() * 40;
      unit = 'percent';
      break;

    case 'occupancy':
      // Normal: 0-50 people, Anomaly: 80-150
      value = isAnomaly ? 80 + Math.floor(Math.random() * 70) : Math.floor(Math.random() * 50);
      unit = 'count';
      break;

    case 'power':
      // Normal: 100-5000W, Anomaly: 8000-15000W
      value = isAnomaly ? 8000 + Math.random() * 7000 : 100 + Math.random() * 4900;
      unit = 'watts';
      break;

    case 'co2':
      // Normal: 400-1000ppm, Anomaly: 1500-3000ppm
      value = isAnomaly ? 1500 + Math.random() * 1500 : 400 + Math.random() * 600;
      unit = 'ppm';
      break;

    case 'pressure':
      // Normal: 1000-1030 hPa, Anomaly: 950-980 or 1040-1060
      value = isAnomaly
        ? Math.random() > 0.5
          ? 1040 + Math.random() * 20
          : 950 + Math.random() * 30
        : 1000 + Math.random() * 30;
      unit = 'hpa';
      break;

    case 'light':
      // Normal: 100-1000 lux, Anomaly: 0-50 or 1500-3000
      value = isAnomaly
        ? Math.random() > 0.5
          ? 1500 + Math.random() * 1500
          : Math.random() * 50
        : 100 + Math.random() * 900;
      unit = 'lux';
      break;

    case 'motion':
      // Binary: 0 or 1 (70% no motion, 30% motion)
      value = Math.random() > 0.7 ? 1 : 0;
      unit = 'boolean';
      break;

    case 'air_quality':
      // Normal: 0-100 AQI (ppm), Anomaly: 150-300
      value = isAnomaly ? 150 + Math.random() * 150 : Math.random() * 100;
      unit = 'ppm';
      break;

    case 'water_flow':
      // Normal: 0.5-50 L/min, Anomaly: 80-150 or 0
      value = isAnomaly
        ? Math.random() > 0.3
          ? 80 + Math.random() * 70
          : 0
        : 0.5 + Math.random() * 49.5;
      unit = 'liters_per_minute';
      break;

    case 'gas':
      // Normal: 0-100ppm, Anomaly: 200-500ppm
      value = isAnomaly ? 200 + Math.random() * 300 : Math.random() * 100;
      unit = 'ppm';
      break;

    case 'vibration':
      // Normal: 0-2, Anomaly: 5-10
      value = isAnomaly ? 5 + Math.random() * 5 : Math.random() * 2;
      unit = 'raw';
      break;

    case 'voltage':
      // Normal: 110-240V, Anomaly: 90-105 or 250-280
      value = isAnomaly
        ? Math.random() > 0.5
          ? 250 + Math.random() * 30
          : 90 + Math.random() * 15
        : 110 + Math.random() * 130;
      unit = 'volts';
      break;

    case 'current':
      // Normal: 0.1-15A, Anomaly: 20-50A
      value = isAnomaly ? 20 + Math.random() * 30 : 0.1 + Math.random() * 14.9;
      unit = 'amperes';
      break;

    case 'energy':
      // Normal: 0-100 kWh, Anomaly: 150-300 kWh
      value = isAnomaly ? 150 + Math.random() * 150 : Math.random() * 100;
      unit = 'kilowatt_hours';
      break;

    default:
      value = Math.random() * 100;
      unit = 'raw';
  }

  return {
    value: parseFloat(value.toFixed(2)),
    unit,
    isAnomaly,
  };
}

/**
 * Generate random context data for a reading
 */
function generateContext() {
  return {
    battery_level: 20 + Math.floor(Math.random() * 80), // 20-100%
    signal_strength: -90 + Math.floor(Math.random() * 60), // -90 to -30 dBm
  };
}

/**
 * Generate quality metrics for a reading
 */
function generateQuality(isAnomaly: boolean) {
  const isValid = Math.random() > 0.02; // 2% invalid readings
  return {
    is_valid: isValid,
    confidence_score: parseFloat((0.85 + Math.random() * 0.15).toFixed(2)), // 0.85-1.0
    validation_flags: [] as string[],
    is_anomaly: isAnomaly,
    anomaly_score: isAnomaly
      ? parseFloat((0.5 + Math.random() * 0.5).toFixed(2)) // 0.5-1.0 for anomalies
      : parseFloat((Math.random() * 0.3).toFixed(2)), // 0-0.3 for normal
  };
}

// ============================================================================
// READING GENERATION
// ============================================================================

async function generateReadings() {
  await dbConnect();

  // Fetch all active V2 devices
  const devices = await DeviceV2.findActive();
  const readings = [];
  const timestamp = new Date();

  for (const device of devices) {
    const { value, unit, isAnomaly } = generateValueForType(device.type as ReadingType);
    const rawValue = value + (Math.random() * 1 - 0.5); // Slight variation for raw value
    const calibrationOffset = parseFloat((Math.random() * 0.5 - 0.25).toFixed(2));

    readings.push({
      metadata: {
        device_id: device._id,
        type: device.type,
        unit: unit,
        source: 'simulation' as const,
      },
      timestamp: timestamp,
      value: value,
      quality: generateQuality(isAnomaly),
      context: generateContext(),
      processing: {
        raw_value: parseFloat(rawValue.toFixed(2)),
        calibration_offset: calibrationOffset,
        ingested_at: new Date(),
      },
    });
  }

  return readings;
}

// ============================================================================
// API ROUTE HANDLER
// ============================================================================

export async function GET() {
  try {
    // 1. Generate mock data
    const newReadings = await generateReadings();

    if (newReadings.length === 0)
      return NextResponse.json(
        {
          success: false,
          error: 'No devices found. Run `pnpm seed` to create V2 devices.',
        },
        { status: 404 }
      );

    // 2. Insert into DB (The "Cold" Store)
    await ReadingV2.bulkInsertReadings(newReadings);

    // 3. Trigger Real-time Update (The "Hot" Path)
    await pusherServer.trigger('InfraSight', 'new-readings', newReadings);

    // Count anomalies for response
    const anomalyCount = newReadings.filter(r => r.quality.is_anomaly).length;

    return NextResponse.json({
      success: true,
      count: newReadings.length,
      anomalies: anomalyCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Simulation error:', error);
    return NextResponse.json({ success: false, error: 'Simulation failed' }, { status: 500 });
  }
}
