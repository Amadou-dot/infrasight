import type { IDeviceV2 } from '../../models/v2/DeviceV2';
import type { IReadingV2, ReadingType, ReadingUnit } from '../../models/v2/ReadingV2';

export type SimulatedDevice = Pick<IDeviceV2, '_id' | 'type' | 'location'>;

interface GeneratedReading {
  value: number;
  unit: ReadingUnit;
  isAnomaly: boolean;
  anomalyScore: number;
}

export interface SimulationProfile {
  anomalyBaseRate: number;
  burstMultiplier: number;
  hotspotType?: ReadingType;
  hotspotFloor?: number;
  volatility: number;
}

const MIN_ANOMALY_PROBABILITY = 0.012;
const MAX_ANOMALY_PROBABILITY = 0.24;

const TYPE_SENSITIVITY: Record<ReadingType, number> = {
  temperature: 1.05,
  humidity: 1.0,
  occupancy: 0.75,
  power: 1.35,
  co2: 1.2,
  pressure: 0.95,
  light: 0.85,
  motion: 0.5,
  air_quality: 1.15,
  water_flow: 1.25,
  gas: 1.4,
  vibration: 1.35,
  voltage: 1.15,
  current: 1.25,
  energy: 1.1,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pickRandom<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.floor(Math.random() * values.length)];
}

function getHourlyLoadFactor(hour: number) {
  if (hour >= 7 && hour <= 9) return 1.3;
  if (hour >= 10 && hour <= 16) return 1.1;
  if (hour >= 17 && hour <= 20) return 1.22;
  if (hour >= 0 && hour <= 5) return 0.82;
  return 0.94;
}

function buildAnomalyScore(anomalyProbability: number, isAnomaly: boolean) {
  if (isAnomaly) {
    const severityFloor = clamp(0.56 + anomalyProbability * 1.1, 0.58, 0.9);
    return round(randomBetween(severityFloor, 1));
  }

  const normalCeiling = clamp(0.08 + anomalyProbability * 0.8, 0.1, 0.35);
  return round(randomBetween(0.01, normalCeiling));
}

export function createSimulationProfile(
  devices: SimulatedDevice[],
  timestamp: Date = new Date()
): SimulationProfile {
  const deviceTypes = [...new Set(devices.map(device => device.type as ReadingType))];
  const floors = [...new Set(devices.map(device => device.location.floor))];
  const localizedBurst = Math.random() < 0.35;
  const systemicBurst = Math.random() < 0.18;

  return {
    anomalyBaseRate: round(
      randomBetween(0.018, 0.048) * getHourlyLoadFactor(timestamp.getUTCHours()),
      4
    ),
    burstMultiplier: systemicBurst
      ? randomBetween(1.8, 3.4)
      : localizedBurst
        ? randomBetween(1.2, 2.4)
        : randomBetween(0.7, 1.25),
    hotspotType: localizedBurst ? pickRandom(deviceTypes) : undefined,
    hotspotFloor: localizedBurst ? pickRandom(floors) : undefined,
    volatility: systemicBurst ? randomBetween(0.9, 1.35) : randomBetween(0.75, 1.15),
  };
}

export function calculateAnomalyProbability(
  device: SimulatedDevice,
  profile: SimulationProfile
) {
  const typeSensitivity = TYPE_SENSITIVITY[device.type as ReadingType] ?? 1;
  const typeBoost = profile.hotspotType === device.type ? 1.75 : 1;
  const floorBoost =
    profile.hotspotFloor !== undefined && profile.hotspotFloor === device.location.floor ? 1.45 : 1;
  const motionPenalty = device.type === 'motion' ? 0.55 : 1;

  return round(
    clamp(
      profile.anomalyBaseRate *
        profile.burstMultiplier *
        typeSensitivity *
        typeBoost *
        floorBoost *
        motionPenalty,
      MIN_ANOMALY_PROBABILITY,
      MAX_ANOMALY_PROBABILITY
    ),
    4
  );
}

function generateValueForType(
  type: ReadingType,
  anomalyProbability: number,
  volatility: number
): GeneratedReading {
  const isAnomaly = Math.random() < anomalyProbability;
  const anomalyScore = buildAnomalyScore(anomalyProbability, isAnomaly);
  const normalJitter = (Math.random() - 0.5) * volatility;

  let value: number;
  let unit: ReadingUnit;

  switch (type) {
    case 'temperature':
      value = isAnomaly
        ? Math.random() > 0.5
          ? 30 + Math.random() * 10
          : 5 + Math.random() * 10
        : 18 + Math.random() * 10 + normalJitter * 1.5;
      unit = 'celsius';
      break;

    case 'humidity':
      value = isAnomaly
        ? Math.random() > 0.5
          ? 80 + Math.random() * 15
          : 10 + Math.random() * 10
        : 30 + Math.random() * 40 + normalJitter * 4;
      unit = 'percent';
      break;

    case 'occupancy':
      value = isAnomaly
        ? 80 + Math.floor(Math.random() * 70)
        : Math.max(0, Math.floor(Math.random() * 50 + normalJitter * 5));
      unit = 'count';
      break;

    case 'power':
      value = isAnomaly ? 8000 + Math.random() * 7000 : 100 + Math.random() * 4900 + normalJitter * 150;
      unit = 'watts';
      break;

    case 'co2':
      value = isAnomaly ? 1500 + Math.random() * 1500 : 400 + Math.random() * 600 + normalJitter * 25;
      unit = 'ppm';
      break;

    case 'pressure':
      value = isAnomaly
        ? Math.random() > 0.5
          ? 1040 + Math.random() * 20
          : 950 + Math.random() * 30
        : 1000 + Math.random() * 30 + normalJitter * 2;
      unit = 'hpa';
      break;

    case 'light':
      value = isAnomaly
        ? Math.random() > 0.5
          ? 1500 + Math.random() * 1500
          : Math.random() * 50
        : 100 + Math.random() * 900 + normalJitter * 40;
      unit = 'lux';
      break;

    case 'motion':
      value = Math.random() > (isAnomaly ? 0.35 : 0.7) ? 1 : 0;
      unit = 'boolean';
      break;

    case 'air_quality':
      value = isAnomaly ? 150 + Math.random() * 150 : Math.random() * 100 + normalJitter * 4;
      unit = 'ppm';
      break;

    case 'water_flow':
      value = isAnomaly
        ? Math.random() > 0.3
          ? 80 + Math.random() * 70
          : 0
        : 0.5 + Math.random() * 49.5 + normalJitter * 2;
      unit = 'liters_per_minute';
      break;

    case 'gas':
      value = isAnomaly ? 200 + Math.random() * 300 : Math.random() * 100 + normalJitter * 4;
      unit = 'ppm';
      break;

    case 'vibration':
      value = isAnomaly ? 5 + Math.random() * 5 : Math.random() * 2 + normalJitter * 0.15;
      unit = 'raw';
      break;

    case 'voltage':
      value = isAnomaly
        ? Math.random() > 0.5
          ? 250 + Math.random() * 30
          : 90 + Math.random() * 15
        : 110 + Math.random() * 130 + normalJitter * 4;
      unit = 'volts';
      break;

    case 'current':
      value = isAnomaly ? 20 + Math.random() * 30 : 0.1 + Math.random() * 14.9 + normalJitter * 0.5;
      unit = 'amperes';
      break;

    case 'energy':
      value = isAnomaly ? 150 + Math.random() * 150 : Math.random() * 100 + normalJitter * 5;
      unit = 'kilowatt_hours';
      break;

    default:
      value = Math.random() * 100;
      unit = 'raw';
  }

  return {
    value: round(value),
    unit,
    isAnomaly,
    anomalyScore,
  };
}

function generateContext(isAnomaly: boolean, anomalyScore: number) {
  const anomalyPenalty = isAnomaly ? Math.round((anomalyScore - 0.5) * 30) : 0;

  return {
    battery_level: clamp(20 + Math.floor(Math.random() * 80) - anomalyPenalty, 20, 100),
    signal_strength: clamp(-90 + Math.floor(Math.random() * 60) - anomalyPenalty, -90, -30),
  };
}

function generateQuality(
  isAnomaly: boolean,
  anomalyScore: number,
  profile: SimulationProfile
) {
  const confidenceFloor = clamp(
    0.9 - (profile.volatility - 1) * 0.05 - (isAnomaly ? 0.03 : 0),
    0.85,
    0.97
  );

  return {
    is_valid: Math.random() > (isAnomaly ? 0.04 : 0.02),
    confidence_score: round(randomBetween(confidenceFloor, 1)),
    validation_flags: [] as string[],
    is_anomaly: isAnomaly,
    anomaly_score: anomalyScore,
  };
}

export function generateSimulatedReadings(
  devices: SimulatedDevice[],
  timestamp: Date = new Date()
): Array<Partial<IReadingV2>> {
  const profile = createSimulationProfile(devices, timestamp);

  return devices.map(device => {
    const anomalyProbability = calculateAnomalyProbability(device, profile);
    const { value, unit, isAnomaly, anomalyScore } = generateValueForType(
      device.type as ReadingType,
      anomalyProbability,
      profile.volatility
    );
    const rawValue = value + (Math.random() * (isAnomaly ? 1.6 : 1) - (isAnomaly ? 0.8 : 0.5));
    const calibrationOffset = round(Math.random() * 0.5 - 0.25);

    return {
      metadata: {
        device_id: device._id,
        type: device.type,
        unit,
        source: 'simulation' as const,
      },
      timestamp,
      value,
      quality: generateQuality(isAnomaly, anomalyScore, profile),
      context: generateContext(isAnomaly, anomalyScore),
      processing: {
        raw_value: round(rawValue),
        calibration_offset: calibrationOffset,
        ingested_at: new Date(),
      },
    };
  });
}
