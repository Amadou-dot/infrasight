/**
 * Alert Selector and Metric Accessor Tests
 */

import { matchesSelector, compare, METRIC_ACCESSORS } from '@/lib/alerting/selector';
import type { EvaluableDevice, EvaluableReading } from '@/lib/alerting/types';

function device(overrides: Partial<EvaluableDevice> = {}): EvaluableDevice {
  return {
    _id: 'device_001',
    type: 'temperature',
    location: { building_id: 'HQ', floor: 3, room_name: 'Lab A', zone: 'north' },
    metadata: { tags: ['critical', 'hvac'], department: 'Facilities' },
    ...overrides,
  } as EvaluableDevice;
}

describe('matchesSelector', () => {
  it('should match an empty selector against any device', () => {
    expect(matchesSelector(device(), {})).toBe(true);
  });

  it('should match on building_id', () => {
    expect(matchesSelector(device(), { building_id: 'HQ' })).toBe(true);
    expect(matchesSelector(device(), { building_id: 'Warehouse' })).toBe(false);
  });

  it('should match on floor, including floor 0', () => {
    expect(matchesSelector(device(), { floor: 3 })).toBe(true);
    expect(matchesSelector(device(), { floor: 4 })).toBe(false);
    expect(matchesSelector(device({ location: { building_id: 'HQ', floor: 0, room_name: 'Lobby' } }), { floor: 0 })).toBe(true);
  });

  it('should match on zone', () => {
    expect(matchesSelector(device(), { zone: 'north' })).toBe(true);
    expect(matchesSelector(device(), { zone: 'south' })).toBe(false);
  });

  it('should require ALL listed tags, not any', () => {
    expect(matchesSelector(device(), { tags: ['critical'] })).toBe(true);
    expect(matchesSelector(device(), { tags: ['critical', 'hvac'] })).toBe(true);
    expect(matchesSelector(device(), { tags: ['critical', 'rooftop'] })).toBe(false);
  });

  it('should treat an empty tags array as no constraint', () => {
    expect(matchesSelector(device(), { tags: [] })).toBe(true);
  });

  it('should require every present dimension simultaneously', () => {
    expect(matchesSelector(device(), { building_id: 'HQ', floor: 3, zone: 'north' })).toBe(true);
    expect(matchesSelector(device(), { building_id: 'HQ', floor: 9, zone: 'north' })).toBe(false);
  });

  it('should not match a device missing the selected dimension', () => {
    const noZone = device({ location: { building_id: 'HQ', floor: 3, room_name: 'Lab A' } } as Partial<EvaluableDevice>);
    expect(matchesSelector(noZone, { zone: 'north' })).toBe(false);
  });

  it('should tolerate a device with no metadata', () => {
    const bare = { _id: 'device_002', type: 'power', location: { building_id: 'HQ', floor: 1, room_name: 'X' } } as EvaluableDevice;
    expect(matchesSelector(bare, {})).toBe(true);
    expect(matchesSelector(bare, { tags: ['critical'] })).toBe(false);
  });

  it('should ignore selector.types — the type dimension is handled by rule bucketing', () => {
    expect(matchesSelector(device(), { types: ['power'] })).toBe(true);
  });
});

describe('compare', () => {
  it.each([
    ['gt', 31, 30, true],
    ['gt', 30, 30, false],
    ['gte', 30, 30, true],
    ['gte', 29, 30, false],
    ['lt', 29, 30, true],
    ['lt', 30, 30, false],
    ['lte', 30, 30, true],
    ['lte', 31, 30, false],
  ] as const)('%s %d vs %d -> %s', (comparison, value, threshold, expected) => {
    expect(compare(value, comparison, threshold)).toBe(expected);
  });
});

describe('METRIC_ACCESSORS', () => {
  const reading: EvaluableReading = {
    value: 35,
    quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.82 },
    context: { battery_level: 14 },
  } as EvaluableReading;

  it('should read value', () => {
    expect(METRIC_ACCESSORS.value(reading)).toBe(35);
  });

  it('should read anomaly_score', () => {
    expect(METRIC_ACCESSORS.anomaly_score(reading)).toBe(0.82);
  });

  it('should read battery_level', () => {
    expect(METRIC_ACCESSORS.battery_level(reading)).toBe(14);
  });

  it('should return undefined for an absent field rather than zero', () => {
    const bare: EvaluableReading = { value: 10 } as EvaluableReading;

    expect(METRIC_ACCESSORS.anomaly_score(bare)).toBeUndefined();
    expect(METRIC_ACCESSORS.battery_level(bare)).toBeUndefined();
  });

  it('should distinguish a real zero from an absent field', () => {
    const zero: EvaluableReading = { value: 0, context: { battery_level: 0 } } as EvaluableReading;

    expect(METRIC_ACCESSORS.value(zero)).toBe(0);
    expect(METRIC_ACCESSORS.battery_level(zero)).toBe(0);
  });
});
