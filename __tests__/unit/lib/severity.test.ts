/**
 * Severity Calculator Tests
 *
 * Tests for device severity calculation, color mapping, icon mapping,
 * date utilities, and batch categorization.
 */

import {
  calculateDeviceSeverity,
  getSeverityColor,
  getSeverityIcon,
  isWithinDays,
  getDaysUntil,
  formatRelativeDate,
  isPast,
  categorizeDevicesBySeverity,
  getDeviceSeverityCounts,
} from '@/lib/utils/severity';
import type { DeviceV2Response } from '@/types/v2';

// ============================================================================
// HELPERS
// ============================================================================

function makeDevice(overrides: Partial<{
  status: string;
  battery_level: number | undefined;
  error_count: number;
  next_maintenance: string | undefined;
  last_seen: Date | string;
}>): DeviceV2Response {
  return {
    _id: 'device_001',
    serial_number: 'SN-001',
    manufacturer: 'TestCo',
    device_model: 'Model-X',
    firmware_version: '1.0.0',
    type: 'temperature',
    configuration: { sampling_interval: 60, reporting_interval: 300, thresholds: { min: 0, max: 100, warning_min: 5, warning_max: 95 } },
    location: { building_id: 'bldg_001', floor: 1, room_name: 'Room A', zone: 'Zone 1', coordinates: { x: 0, y: 0 } },
    metadata: {
      tags: [],
      department: 'Engineering',
      next_maintenance: overrides.next_maintenance ?? undefined,
    },
    audit: { created_by: 'test', created_at: new Date(), updated_by: 'test', updated_at: new Date(), version: 1, change_history: [] },
    health: {
      last_seen: overrides.last_seen ?? new Date(),
      uptime_percentage: 99,
      error_count: overrides.error_count ?? 0,
      battery_level: overrides.battery_level ?? undefined,
      signal_strength: 80,
    },
    status: (overrides.status ?? 'active') as DeviceV2Response['status'],
    compliance: { data_classification: 'internal', retention_days: 90, last_audit_date: new Date() },
  } as unknown as DeviceV2Response;
}

// ============================================================================
// TESTS
// ============================================================================

describe('calculateDeviceSeverity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --- Critical conditions ---

  it('returns critical when device status is error', () => {
    const device = makeDevice({ status: 'error' });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('critical');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STATUS_ERROR' })])
    );
  });

  it('returns critical when battery is below 15%', () => {
    const device = makeDevice({ battery_level: 10 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('critical');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BATTERY_CRITICAL' })])
    );
  });

  it('returns critical when error_count > 10', () => {
    const device = makeDevice({ error_count: 15 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('critical');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'HIGH_ERROR_COUNT' })])
    );
  });

  it('returns critical when maintenance is overdue', () => {
    const device = makeDevice({ next_maintenance: '2025-06-01T00:00:00Z' });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('critical');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MAINTENANCE_OVERDUE' })])
    );
    expect(result.reasons[0].message).toContain('14 days');
  });

  it('returns early with critical (skips warning checks) when critical', () => {
    // Device is in error AND offline — should only have critical reasons
    const device = makeDevice({ status: 'error' });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('critical');
    // Should NOT include warning-level codes like OFFLINE
    const codes = result.reasons.map(r => r.code);
    expect(codes).not.toContain('OFFLINE');
  });

  it('accumulates multiple critical reasons', () => {
    const device = makeDevice({ status: 'error', battery_level: 5, error_count: 20 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('critical');
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  // --- Warning conditions ---

  it('returns warning when device status is maintenance', () => {
    const device = makeDevice({ status: 'maintenance' });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('warning');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IN_MAINTENANCE' })])
    );
  });

  it('returns warning when battery is between 15% and 30%', () => {
    const device = makeDevice({ battery_level: 25 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('warning');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BATTERY_LOW' })])
    );
  });

  it('returns warning when maintenance due within 7 days', () => {
    const device = makeDevice({ next_maintenance: '2025-06-18T12:00:00Z' });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('warning');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MAINTENANCE_DUE' })])
    );
  });

  it('returns warning when device has not been seen for over 1 hour', () => {
    const twoHoursAgo = new Date('2025-06-15T10:00:00Z');
    const device = makeDevice({ last_seen: twoHoursAgo });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('warning');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NOT_RESPONDING' })])
    );
  });

  it('does NOT flag NOT_RESPONDING if device status is offline', () => {
    const twoHoursAgo = new Date('2025-06-15T10:00:00Z');
    const device = makeDevice({ status: 'offline', last_seen: twoHoursAgo });
    const result = calculateDeviceSeverity(device);
    const codes = result.reasons.map(r => r.code);
    expect(codes).not.toContain('NOT_RESPONDING');
    expect(codes).toContain('OFFLINE');
  });

  it('returns warning when device status is offline', () => {
    const device = makeDevice({ status: 'offline' });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('warning');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'OFFLINE' })])
    );
  });

  // --- Healthy ---

  it('returns healthy with HEALTHY reason when no issues', () => {
    const device = makeDevice({ status: 'active', battery_level: 80, error_count: 0 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('healthy');
    expect(result.reasons).toEqual([{ code: 'HEALTHY', message: 'All systems normal' }]);
  });

  it('returns healthy when battery_level is undefined (no battery)', () => {
    const device = makeDevice({ battery_level: undefined, error_count: 0 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('healthy');
  });

  // --- Boundary conditions ---

  it('battery at exactly 15 is not critical (< 15 is critical)', () => {
    const device = makeDevice({ battery_level: 15 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).not.toBe('critical');
  });

  it('battery at exactly 14 is critical', () => {
    const device = makeDevice({ battery_level: 14 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).toBe('critical');
  });

  it('battery at exactly 30 is not warning (< 30 is warning)', () => {
    const device = makeDevice({ battery_level: 30 });
    const result = calculateDeviceSeverity(device);
    // 30 is NOT < 30, so should be healthy
    expect(result.severity).toBe('healthy');
  });

  it('error_count at exactly 10 is not critical (> 10 required)', () => {
    const device = makeDevice({ error_count: 10 });
    const result = calculateDeviceSeverity(device);
    expect(result.severity).not.toBe('critical');
  });
});

describe('getSeverityColor', () => {
  it('returns red colors for critical', () => {
    const colors = getSeverityColor('critical');
    expect(colors.bg).toContain('red');
    expect(colors.text).toContain('red');
    expect(colors.border).toContain('red');
    expect(colors.badge).toContain('red');
  });

  it('returns amber colors for warning', () => {
    const colors = getSeverityColor('warning');
    expect(colors.bg).toContain('amber');
    expect(colors.text).toContain('amber');
    expect(colors.border).toContain('amber');
    expect(colors.badge).toContain('amber');
  });

  it('returns green colors for healthy', () => {
    const colors = getSeverityColor('healthy');
    expect(colors.bg).toContain('green');
    expect(colors.text).toContain('green');
    expect(colors.border).toContain('green');
    expect(colors.badge).toContain('green');
  });
});

describe('getSeverityIcon', () => {
  it('returns AlertCircle for critical', () => {
    expect(getSeverityIcon('critical')).toBe('AlertCircle');
  });

  it('returns AlertTriangle for warning', () => {
    expect(getSeverityIcon('warning')).toBe('AlertTriangle');
  });

  it('returns CheckCircle for healthy', () => {
    expect(getSeverityIcon('healthy')).toBe('CheckCircle');
  });
});

describe('isWithinDays', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns true for date within range', () => {
    expect(isWithinDays('2025-06-17T12:00:00Z', 5)).toBe(true);
  });

  it('returns false for date beyond range', () => {
    expect(isWithinDays('2025-06-25T12:00:00Z', 5)).toBe(false);
  });

  it('returns false for past dates', () => {
    expect(isWithinDays('2025-06-10T12:00:00Z', 5)).toBe(false);
  });

  it('accepts Date objects', () => {
    expect(isWithinDays(new Date('2025-06-16T12:00:00Z'), 3)).toBe(true);
  });

  it('boundary: exactly 0 days from now is within range', () => {
    expect(isWithinDays('2025-06-15T12:00:00Z', 0)).toBe(true);
  });

  it('boundary: exactly N days away is within range', () => {
    expect(isWithinDays('2025-06-20T12:00:00Z', 5)).toBe(true);
  });
});

describe('getDaysUntil', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns positive number for future date', () => {
    expect(getDaysUntil('2025-06-20T12:00:00Z')).toBe(5);
  });

  it('returns negative number for past date', () => {
    expect(getDaysUntil('2025-06-10T12:00:00Z')).toBe(-5);
  });

  it('returns 0 for today', () => {
    expect(getDaysUntil('2025-06-15T12:00:00Z')).toBe(0);
  });

  it('accepts Date objects', () => {
    expect(getDaysUntil(new Date('2025-06-18T12:00:00Z'))).toBe(3);
  });

  it('uses Math.ceil (rounds up partial days)', () => {
    // 2.5 days in the future -> ceil = 3
    expect(getDaysUntil('2025-06-18T00:00:00Z')).toBe(3);
  });
});

describe('formatRelativeDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "today" for current date', () => {
    expect(formatRelativeDate('2025-06-15T12:00:00Z')).toBe('today');
  });

  it('returns "tomorrow" for next day', () => {
    expect(formatRelativeDate('2025-06-16T12:00:00Z')).toBe('tomorrow');
  });

  it('returns "in N days" for future dates', () => {
    expect(formatRelativeDate('2025-06-20T12:00:00Z')).toBe('in 5 days');
  });

  it('returns "yesterday" for previous day', () => {
    // getDaysUntil for 1 day ago = -1, abs = 1
    expect(formatRelativeDate('2025-06-14T12:00:00Z')).toBe('yesterday');
  });

  it('returns "N days ago" for past dates', () => {
    expect(formatRelativeDate('2025-06-10T12:00:00Z')).toBe('5 days ago');
  });
});

describe('isPast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns true for past date string', () => {
    expect(isPast('2025-06-10T12:00:00Z')).toBe(true);
  });

  it('returns false for future date string', () => {
    expect(isPast('2025-06-20T12:00:00Z')).toBe(false);
  });

  it('returns false for current time (not strictly past)', () => {
    expect(isPast('2025-06-15T12:00:00Z')).toBe(false);
  });

  it('accepts Date objects', () => {
    expect(isPast(new Date('2025-01-01'))).toBe(true);
  });
});

describe('categorizeDevicesBySeverity', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('categorizes devices into correct buckets', () => {
    const devices = [
      makeDevice({ status: 'error' }),
      makeDevice({ status: 'active', battery_level: 80, error_count: 0 }),
      makeDevice({ status: 'maintenance' }),
    ];
    const result = categorizeDevicesBySeverity(devices);
    expect(result.critical).toHaveLength(1);
    expect(result.healthy).toHaveLength(1);
    expect(result.warning).toHaveLength(1);
  });

  it('returns empty arrays for empty input', () => {
    const result = categorizeDevicesBySeverity([]);
    expect(result.critical).toHaveLength(0);
    expect(result.warning).toHaveLength(0);
    expect(result.healthy).toHaveLength(0);
  });
});

describe('getDeviceSeverityCounts', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns correct counts', () => {
    const devices = [
      makeDevice({ status: 'error' }),
      makeDevice({ status: 'active', battery_level: 80, error_count: 0 }),
      makeDevice({ status: 'active', battery_level: 90, error_count: 0 }),
      makeDevice({ status: 'maintenance' }),
    ];
    const counts = getDeviceSeverityCounts(devices);
    expect(counts.critical).toBe(1);
    expect(counts.healthy).toBe(2);
    expect(counts.warning).toBe(1);
    expect(counts.total).toBe(4);
  });

  it('returns zeros for empty array', () => {
    const counts = getDeviceSeverityCounts([]);
    expect(counts).toEqual({ critical: 0, warning: 0, healthy: 0, total: 0 });
  });
});
