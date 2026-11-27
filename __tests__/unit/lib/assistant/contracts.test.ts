import { outputSchemas, parseToolArgs, resolveWindow, TOOLS } from '@/lib/assistant/contracts';

const AS_OF = '2026-11-25T15:20:00.123Z';
const READING = {
  id: '6656c80fb0d4e402363631e1',
  device_id: 'device_015',
  timestamp: '2026-11-25T15:05:00.123Z',
  value: 45.2,
  type: 'temperature',
  unit: 'celsius',
  source: 'simulation',
  is_valid: false,
  is_anomaly: true,
  anomaly_score: null,
  confidence_score: null,
};
const READING_PAGE = { rows: [READING], returned: 1, total: 2, truncated: true };
const ANOMALIES = {
  ...READING_PAGE,
  by_device: [{ device_id: 'device_015', count: 2, avg_score: null }],
  breakdown_limit: 10,
  includes_invalid: true,
  includes_deleted_or_missing_devices: false,
};
const DEVICE = {
  id: 'device_015',
  serial_number: 'SN-015',
  type: 'temperature',
  building_id: 'north',
  floor: 0,
  room_name: 'Ground floor',
  status: 'active',
};

describe('assistant tool arguments', () => {
  it('advertises exactly five strict tools with every property required', () => {
    const expectedFields = {
      find_devices: ['search', 'building_id', 'floor', 'type', 'limit'],
      get_health_summary: ['building_id', 'floor'],
      get_anomalies: ['device_ids', 'start', 'end', 'min_score', 'limit'],
      get_device: ['device_id'],
      get_readings_window: ['device_id', 'start', 'end', 'limit'],
    };

    expect(TOOLS.map(tool => tool.name).sort()).toEqual(Object.keys(expectedFields).sort());
    for (const tool of TOOLS) {
      const fields = expectedFields[tool.name];
      expect(tool).toMatchObject({
        type: 'function',
        strict: true,
        parameters: { type: 'object', additionalProperties: false },
      });
      expect(tool.parameters.required).toEqual(expect.arrayContaining(fields));
      expect(tool.parameters.required).toHaveLength(fields.length);
      expect(Object.keys(tool.parameters.properties ?? {}).sort()).toEqual([...fields].sort());
    }
    expect(TOOLS.find(tool => tool.name === 'find_devices')?.parameters.properties?.search).toEqual(
      {
        anyOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'null' }],
      }
    );
  });

  it('keeps zero-valued filters', () => {
    expect(parseToolArgs('get_health_summary', '{"building_id":null,"floor":0}')).toEqual({
      building_id: null,
      floor: 0,
    });
    const anomalies = { device_ids: null, start: null, end: null, min_score: 0, limit: 1 };
    expect(parseToolArgs('get_anomalies', JSON.stringify(anomalies))).toEqual(anomalies);
  });

  it.each([
    [' \nRack\t  12  ', 'Rack 12'],
    ['Rack (A).* + price$5\\B', 'Rack (A).* + price$5\\B'],
  ])('uses the canonical literal search for %j', (search, expected) => {
    const args = { search, building_id: null, floor: null, type: null, limit: 1 };
    expect(parseToolArgs('find_devices', JSON.stringify(args))).toEqual({
      ...args,
      search: expected,
    });
  });

  it.each(['  \t\n ', '$where', 'rack$in', 'rack\x00'])(
    'rejects search %j after normalization',
    search => {
      const args = { search, building_id: null, floor: null, type: null, limit: 1 };
      expect(() => parseToolArgs('find_devices', JSON.stringify(args))).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENTS' })
      );
    }
  );

  it.each([
    ['malformed JSON', 'get_device', '{'],
    ['unknown authority', 'get_device', '{"device_id":"device_015","org_id":"org_other"}'],
    ['missing nullable field', 'get_health_summary', '{"floor":0}'],
    ['out-of-bounds floor', 'get_health_summary', '{"building_id":null,"floor":201}'],
    ['untrusted device ID', 'get_device', '{"device_id":"device/015"}'],
    [
      'empty device subset',
      'get_anomalies',
      '{"device_ids":[],"start":null,"end":null,"min_score":null,"limit":1}',
    ],
    [
      'duplicate device IDs',
      'get_anomalies',
      '{"device_ids":["device_015","device_016","device_015"],"start":null,"end":null,"min_score":0,"limit":1}',
    ],
    [
      'partial window',
      'get_anomalies',
      '{"device_ids":null,"start":"2026-11-25T00:00:00Z","end":null,"min_score":null,"limit":1}',
    ],
    [
      'timestamp offset',
      'get_readings_window',
      '{"device_id":"device_015","start":"2026-11-25T00:00:00+00:00","end":"2026-11-25T03:00:00Z","limit":1}',
    ],
    [
      'page size above twenty',
      'find_devices',
      '{"search":null,"building_id":null,"floor":null,"type":null,"limit":21}',
    ],
    ['over 4096 UTF-8 bytes', 'get_device', '{"device_id":"device_015"}'.padStart(4097)],
  ])('rejects %s with a safe error', (_reason, name, json) => {
    expect(() => parseToolArgs(name, json)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENTS', message: 'INVALID_ARGUMENTS' })
    );
  });

  it('allows exactly 4096 bytes of arguments', () => {
    const json = '{"device_id":"device_015"}'.padStart(4096);
    expect(parseToolArgs('get_device', json)).toEqual({ device_id: 'device_015' });
  });

  it('counts multibyte characters at the validation boundary', () => {
    const search = '日'.repeat(80);
    const json = JSON.stringify({ search, building_id: null, floor: null, type: null, limit: 1 });
    expect(() => parseToolArgs('find_devices', json.padStart(4000))).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENTS' })
    );
  });

  it.each(['unknown', '__proto__', 'constructor'])('rejects unknown tool %s', name => {
    expect(() => parseToolArgs(name, '{}')).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_TOOL', message: 'UNKNOWN_TOOL' })
    );
  });
});

describe('assistant window bounds', () => {
  it('defaults to the previous 24 hours from a single request anchor', () => {
    expect(resolveWindow(null, null, AS_OF, 168)).toEqual({
      start: '2026-11-24T15:20:00.123Z',
      end: AS_OF,
    });
  });

  it('canonicalizes UTC instants and permits exactly seven days', () => {
    expect(resolveWindow('2026-11-18T15:20:00.123Z', AS_OF, AS_OF, 168)).toEqual({
      start: '2026-11-18T15:20:00.123Z',
      end: AS_OF,
    });
    expect(resolveWindow('2026-11-25T12:00:00Z', AS_OF, AS_OF, 24)).toEqual({
      start: '2026-11-25T12:00:00.000Z',
      end: AS_OF,
    });
    expect(resolveWindow('2026-11-25T12:00:00.1230Z', AS_OF, AS_OF, 24)).toEqual({
      start: '2026-11-25T12:00:00.123Z',
      end: AS_OF,
    });
  });

  it.each([
    [null, AS_OF, 'INVALID_ARGUMENTS'],
    [AS_OF, AS_OF, 'INVALID_ARGUMENTS'],
    [AS_OF, '2026-11-25T12:00:00.000Z', 'INVALID_ARGUMENTS'],
    ['2026-11-25T00:00:00.000Z', '2026-11-25T15:20:00.124Z', 'INVALID_ARGUMENTS'],
    ['2026-11-25T00:00:00.000Z', '2026-11-25T15:20:00.1231Z', 'INVALID_ARGUMENTS'],
    ['2026-11-25T00:00:00.0001Z', AS_OF, 'INVALID_ARGUMENTS'],
    ['2026-11-24T12:00:00+00:00', AS_OF, 'INVALID_ARGUMENTS'],
    ['2026-11-18T15:20:00.122Z', AS_OF, 'OUTSIDE_RETENTION'],
    ['2026-11-24T15:20:00.122Z', AS_OF, 'RANGE_TOO_WIDE'],
  ])('rejects %s through %s with %s', (start, end, code) => {
    expect(() => resolveWindow(start, end, AS_OF, 24)).toThrow(expect.objectContaining({ code }));
  });
});

describe('assistant output contracts', () => {
  it('preserves an invalid simulated reading in a partial page', () => {
    expect(outputSchemas.get_readings_window.parse(READING_PAGE)).toEqual(READING_PAGE);
  });

  it.each([
    { value: Infinity },
    { anomaly_score: 1.01 },
    { confidence_score: undefined },
    { timestamp: '2026-11-25T15:05:00+00:00' },
    { device_id: 'device/015' },
    { source: 'unclassified' },
    { unit: 'arbitrary' },
    { type: 'unclassified' },
    { raw_error: 'private details' },
  ])('rejects an invalid reading field %o', changes => {
    expect(
      outputSchemas.get_readings_window.safeParse({
        ...READING_PAGE,
        rows: [{ ...READING, ...changes }],
      }).success
    ).toBe(false);
  });

  it.each([
    ['row mismatch', { returned: 0 }],
    ['total less than returned', { total: 0 }],
    ['inconsistent truncation', { truncated: false }],
    [
      'more than 20 rows',
      { rows: Array(21).fill(READING), returned: 21, total: 21, truncated: false },
    ],
  ])('rejects a page with %s', (_reason, changes) => {
    expect(
      outputSchemas.get_readings_window.safeParse({ ...READING_PAGE, ...changes }).success
    ).toBe(false);
  });

  it('keeps missing anomaly averages and fleet scope explicit', () => {
    expect(outputSchemas.get_anomalies.parse(ANOMALIES)).toEqual(ANOMALIES);
    const fleet = { ...ANOMALIES, includes_deleted_or_missing_devices: true };
    expect(outputSchemas.get_anomalies.parse(fleet)).toEqual(fleet);
  });

  it.each([
    ['invalid readings excluded', { includes_invalid: false }],
    ['unflagged readings', { rows: [{ ...READING, is_anomaly: false }] }],
    ['more than 10 device counts', { by_device: Array(11).fill(ANOMALIES.by_device[0]) }],
  ])('rejects an anomaly result with %s', (_reason, changes) => {
    expect(outputSchemas.get_anomalies.safeParse({ ...ANOMALIES, ...changes }).success).toBe(false);
  });

  it('rejects health samples above ten or with incorrect thresholds', () => {
    const health = {
      total_devices: 11,
      active_devices: 11,
      health_score: 100,
      devices_with_issues: 11,
      offline: { count: 0, threshold_minutes: 5, sample: [] },
      low_battery: { count: 0, threshold_percent: 20, sample: [] },
      error: { count: 11, sample: [] },
    };
    expect(outputSchemas.get_health_summary.safeParse(health).success).toBe(true);
    expect(
      outputSchemas.get_health_summary.safeParse({
        ...health,
        offline: { ...health.offline, threshold_minutes: 12 },
      }).success
    ).toBe(false);
    expect(
      outputSchemas.get_health_summary.safeParse({
        ...health,
        error: {
          count: 11,
          sample: Array.from({ length: 11 }, (_, i) => ({ id: `device_${i}`, error_count: 1 })),
        },
      }).success
    ).toBe(false);
  });

  it('keeps nullable device health while rejecting extra properties', () => {
    const device = {
      ...DEVICE,
      last_seen: null,
      battery_level: null,
      uptime_percentage: null,
      error_count: 0,
    };
    expect(outputSchemas.get_device.parse(device)).toEqual(device);
    expect(outputSchemas.get_device.safeParse({ ...device, audit_actor: 'private' }).success).toBe(
      false
    );
    expect(outputSchemas.get_device.safeParse({ ...device, status: 'unknown' }).success).toBe(
      false
    );
  });

  it('strips control characters from retained room labels', () => {
    const page = {
      rows: [{ ...DEVICE, room_name: 'Ground \x00floor\n\x85' }],
      returned: 1,
      total: 1,
      truncated: false,
    };
    expect(outputSchemas.find_devices.parse(page).rows[0]?.room_name).toBe('Ground floor');
  });

  it.each([' \x00\n ', 'A'.repeat(101)])('rejects invalid room labels %j', room_name => {
    const page = { rows: [{ ...DEVICE, room_name }], returned: 1, total: 1, truncated: false };
    expect(outputSchemas.find_devices.safeParse(page).success).toBe(false);
  });
});
