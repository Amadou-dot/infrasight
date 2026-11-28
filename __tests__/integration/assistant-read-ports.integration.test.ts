import { Types } from 'mongoose';
import { readAnomalies } from '@/lib/analytics/anomalies';
import { readPorts } from '@/lib/assistant/read-ports';
import { getOrSet } from '@/lib/cache';
import { createReadContext } from '@/lib/data/read-context';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import { createDeviceInput, createReadingV2Input } from '../setup/factories';

jest.mock('@/lib/cache', () => ({ ...jest.requireActual('@/lib/cache'), getOrSet: jest.fn() }));

// Keep MongoDB reads real, with the same JSON boundary Redis uses in production.
const entries = new Map<string, string>();
const cache = async <T>(key: string, compute: () => Promise<T>): Promise<T> => {
  const cached = entries.get(key);
  if (cached !== undefined) return JSON.parse(cached);
  const value = await compute();
  entries.set(key, JSON.stringify(value));
  return value;
};

beforeEach(() => {
  entries.clear();
  jest.mocked(getOrSet).mockImplementation(cache);
});
afterEach(() => jest.restoreAllMocks());

function context() {
  return createReadContext('org_assistant_test', new AbortController().signal);
}

function window() {
  const end = Date.now();
  return { start: new Date(end - 60_000).toISOString(), end: new Date(end).toISOString() };
}

it('projects current devices and orders partial searches by serial number', async () => {
  const room = { building_id: 'building_001', floor: 0, room_name: 'Lobby' };
  await DeviceV2.create([
    createDeviceInput({ _id: 'last', serial_number: 'Z-SERIAL', location: room }),
    createDeviceInput({ _id: 'first', serial_number: 'B-SERIAL', location: room }),
    createDeviceInput({
      _id: 'deleted',
      serial_number: 'A-SERIAL',
      location: room,
      audit: { deleted_at: new Date(), deleted_by: 'private-actor' },
    }),
  ]);

  const find = jest.spyOn(DeviceV2.collection, 'find');
  const read = await readPorts.find_devices(await context(), {
    search: 'Lobby',
    building_id: 'building_001',
    floor: 0,
    type: null,
    limit: 1,
  });

  expect(read.data).toEqual({
    rows: [
      { id: 'first', serial_number: 'B-SERIAL', ...room, type: 'temperature', status: 'active' },
    ],
    total: 2,
    returned: 1,
    truncated: true,
  });
  expect(find.mock.calls[0][1]?.projection).toEqual({
    _id: 1,
    serial_number: 1,
    'location.building_id': 1,
    'location.floor': 1,
    'location.room_name': 1,
    type: 1,
    status: 1,
  });
});

it('rejects a full-looking device page when another matching device lies beyond it', async () => {
  const location = { building_id: 'building_001', floor: 0, room_name: 'Lobby' };
  const device = (id: string) =>
    createDeviceInput({ _id: id, serial_number: `SN-${id}`, location });
  await DeviceV2.create([device('a'), device('c')]);
  const earlierCount = await DeviceV2.countDocuments({ 'location.floor': 0 });
  await DeviceV2.create(device('b'));
  // The independent count saw A and C, while the sorted page now starts with A and B.
  jest.spyOn(DeviceV2.collection, 'countDocuments').mockResolvedValueOnce(earlierCount);
  await expect(
    readPorts.find_devices(await context(), {
      search: null,
      building_id: 'building_001',
      floor: 0,
      type: null,
      limit: 2,
    })
  ).rejects.toMatchObject({ code: 'INVALID_RESULT' });
});

it('maps threshold counts and health samples without expanding them into full lists', async () => {
  const offlineAt = new Date(Date.now() - 6 * 60_000);
  await DeviceV2.create(
    Array.from({ length: 11 }, (_, index) => {
      const device = createDeviceInput({ _id: `issue_${index}`, status: 'error' });
      return {
        ...device,
        location: { ...device.location, floor: 0 },
        health: {
          last_seen: offlineAt,
          battery_level: 19,
          error_count: 2,
          last_error: { timestamp: offlineAt, message: 'private-error', code: 'private-code' },
        },
      };
    })
  );

  const read = await readPorts.get_health_summary(await context(), {
    building_id: 'building_001',
    floor: 0,
  });

  expect(read.data).toEqual({
    total_devices: 11,
    active_devices: 0,
    health_score: 0,
    devices_with_issues: 11,
    offline: { count: 11, threshold_minutes: 5, sample: expect.any(Array) },
    low_battery: { count: 11, threshold_percent: 20, sample: expect.any(Array) },
    error: { count: 11, sample: expect.any(Array) },
  });
  expect(read.data.offline.sample).toHaveLength(10);
  expect(read.data.low_battery.sample).toHaveLength(10);
  expect(read.data.error.sample).toHaveLength(10);
  for (const sample of read.data.offline.sample)
    expect(sample).toEqual({
      id: expect.stringMatching(/^issue_/),
      last_seen: offlineAt.toISOString(),
    });
  for (const sample of read.data.low_battery.sample)
    expect(sample).toEqual({ id: expect.stringMatching(/^issue_/), battery_level: 19 });
  for (const sample of read.data.error.sample)
    expect(sample).toEqual({ id: expect.stringMatching(/^issue_/), error_count: 2 });
});

it('uses the final undeleted predicate for detail even when audit fields are outside the projection', async () => {
  const device = createDeviceInput({ _id: 'detail_device' });
  await DeviceV2.create(device);
  const ctx = await context();
  const find = DeviceV2.collection.findOne.bind(DeviceV2.collection);
  const read = await readPorts.get_device(ctx, { device_id: device._id });
  expect(read.data).toEqual({
    id: device._id,
    serial_number: device.serial_number,
    type: 'temperature',
    building_id: 'building_001',
    floor: 1,
    room_name: 'Room 101',
    status: 'active',
    last_seen: expect.any(String),
    battery_level: null,
    uptime_percentage: 100,
    error_count: 0,
  });

  jest.spyOn(DeviceV2.collection, 'findOne').mockImplementationOnce(async (filter, options) => {
    await DeviceV2.softDelete(device._id);
    return find(filter, options);
  });
  await expect(readPorts.get_device(ctx, { device_id: device._id })).rejects.toMatchObject({
    code: 'DEVICE_UNAVAILABLE',
  });
});

it('returns partial readings ordered by timestamp and ID with source, validity and nullable scores', async () => {
  const device = await DeviceV2.create(createDeviceInput({ _id: 'reading_device' }));
  const bounds = window();
  const sameTime = new Date(bounds.start);
  // Reverse the insertion order for rows that share a time-series bucket and timestamp.
  const larger = new Types.ObjectId('000000000000000000000002');
  const smaller = new Types.ObjectId('000000000000000000000001');
  const reading = createReadingV2Input(device._id, {
    timestamp: sameTime,
    value: 0,
    metadata: { device_id: device._id, type: 'temperature', unit: 'celsius', source: 'simulation' },
    context: { ambient_temp: 17 },
  });
  const quality = { is_valid: false, is_anomaly: true, validation_flags: ['private-flag'] };
  await ReadingV2.collection.insertMany([
    { ...reading, _id: larger, quality },
    { ...reading, _id: smaller, quality },
  ]);

  const read = await readPorts.get_readings_window(await context(), {
    ...bounds,
    device_id: device._id,
    limit: 1,
  });

  expect(read.data).toEqual({
    total: 2,
    returned: 1,
    truncated: true,
    rows: [
      {
        id: smaller.toHexString(),
        device_id: device._id,
        timestamp: bounds.start,
        value: 0,
        type: 'temperature',
        unit: 'celsius',
        source: 'simulation',
        is_valid: false,
        is_anomaly: true,
        anomaly_score: null,
        confidence_score: null,
      },
    ],
  });
});

it('returns an empty readings page for a current device but refuses a deletion during the query', async () => {
  const { _id: id } = await DeviceV2.create(createDeviceInput({ _id: 'reading_race' }));
  const filters = { ...window(), device_id: id, limit: 20 };
  const ctx = await context();
  await expect(readPorts.get_readings_window(ctx, filters)).resolves.toMatchObject({
    data: { total: 0, returned: 0, rows: [], truncated: false },
  });

  const count = ReadingV2.collection.countDocuments.bind(ReadingV2.collection);
  jest
    .spyOn(ReadingV2.collection, 'countDocuments')
    .mockImplementationOnce(async (filter, options) => {
      const total = await count(filter, options);
      await DeviceV2.softDelete(id);
      return total;
    });
  await expect(readPorts.get_readings_window(ctx, filters)).rejects.toMatchObject({
    code: 'DEVICE_UNAVAILABLE',
  });
});

it('requires the readings page to corroborate a count that calls it complete', async () => {
  const device = await DeviceV2.create(createDeviceInput());
  const bounds = window();
  const reading = createReadingV2Input(device._id, { timestamp: new Date(bounds.start) });
  await ReadingV2.create([reading, reading, reading]);
  jest.spyOn(ReadingV2.collection, 'countDocuments').mockResolvedValueOnce(2);
  await expect(
    readPorts.get_readings_window(await context(), {
      ...bounds,
      device_id: device._id,
      limit: 2,
    })
  ).rejects.toMatchObject({ code: 'INVALID_RESULT' });
});

it('requires an anomaly page lookahead even when ten groups can account for the earlier count', async () => {
  const bounds = window();
  await ReadingV2.create(
    Array.from({ length: 11 }, (_, i) =>
      createReadingV2Input(`device_${i}`, {
        timestamp: new Date(bounds.start),
        quality: { is_valid: true, is_anomaly: true },
      })
    )
  );
  jest.spyOn(ReadingV2.collection, 'countDocuments').mockResolvedValueOnce(10);
  await expect(
    readPorts.get_anomalies(await context(), {
      ...bounds,
      device_ids: null,
      min_score: null,
      limit: 10,
    })
  ).rejects.toMatchObject({ code: 'INVALID_RESULT' });
});

it('retains the selected/global anomaly cohort and counts invalid or scoreless flags as stored', async () => {
  const current = await DeviceV2.create(createDeviceInput({ _id: 'current' }));
  const bounds = window();
  const timestamp = new Date(bounds.start);
  const flagged = { is_valid: false, is_anomaly: true };
  await ReadingV2.create([
    createReadingV2Input(current._id, { timestamp, quality: flagged }),
    createReadingV2Input(current._id, { timestamp, quality: { ...flagged, anomaly_score: 0 } }),
    createReadingV2Input('missing', { timestamp, quality: flagged }),
  ]);
  const ctx = await context();
  const filters = { ...bounds, min_score: null, limit: 1 };

  const aggregate = jest.spyOn(ReadingV2.collection, 'aggregate');
  const global = (await readPorts.get_anomalies(ctx, { ...filters, device_ids: null })).data;
  expect(aggregate).toHaveBeenCalledTimes(1);
  expect(global).toMatchObject({
    total: 3,
    returned: 1,
    truncated: true,
    breakdown_limit: 10,
    includes_invalid: true,
    includes_deleted_or_missing_devices: true,
    by_device: [
      { device_id: 'current', count: 2, avg_score: 0 },
      { device_id: 'missing', count: 1, avg_score: null },
    ],
  });
  const selected = (
    await readPorts.get_anomalies(ctx, {
      ...filters,
      device_ids: [current._id],
      min_score: 0,
    })
  ).data;
  expect(selected).toMatchObject({
    total: 1,
    returned: 1,
    truncated: false,
    includes_invalid: true,
    includes_deleted_or_missing_devices: false,
    rows: [{ device_id: current._id, anomaly_score: 0, is_valid: false, is_anomaly: true }],
  });
});

it('keeps device-only and full anomaly breakdowns in separate cache entries', async () => {
  const bounds = window();
  await ReadingV2.create(
    createReadingV2Input('device_001', {
      timestamp: new Date(bounds.start),
      quality: { is_valid: true, is_anomaly: true },
    })
  );
  const ctx = await context();
  const query = {
    startDate: new Date(bounds.start),
    endDate: new Date(bounds.end),
    page: 1,
    limit: 1,
    sortBy: 'timestamp',
    sortDirection: 'desc',
  } as const;
  const aggregate = jest.spyOn(ReadingV2.collection, 'aggregate');
  await readAnomalies(ctx, query, { includeTypeBreakdown: false });
  expect(aggregate).toHaveBeenCalledTimes(1);
  const full = await readAnomalies(ctx, query);
  expect(full.data.summary.by_type).toMatchObject([{ type: 'temperature', count: 1 }]);
  expect(aggregate).toHaveBeenCalledTimes(3);
  await readAnomalies(ctx, query, { includeTypeBreakdown: false });
  expect(aggregate).toHaveBeenCalledTimes(3);
});

it('rejects the entire explicit anomaly selection if any ID becomes unavailable on a cache hit', async () => {
  const ids = ['with_flags', 'without_flags'];
  await DeviceV2.create(ids.map(_id => createDeviceInput({ _id })));
  const bounds = window();
  await ReadingV2.create(
    createReadingV2Input(ids[0], {
      timestamp: new Date(bounds.start),
      quality: { is_valid: true, is_anomaly: true },
    })
  );
  const ctx = await context();
  const filters = { ...bounds, min_score: null, limit: 1, device_ids: ids };
  await expect(readPorts.get_anomalies(ctx, filters)).resolves.toMatchObject({
    data: { total: 1 },
  });

  jest.mocked(getOrSet).mockImplementationOnce(async (key, compute) => {
    expect(entries.has(key)).toBe(true);
    await DeviceV2.softDelete(ids[1]);
    return cache(key, compute);
  });
  await expect(readPorts.get_anomalies(ctx, filters)).rejects.toMatchObject({
    code: 'DEVICE_UNAVAILABLE',
  });

  jest.mocked(getOrSet).mockClear();
  await expect(readPorts.get_anomalies(ctx, filters)).rejects.toMatchObject({
    code: 'DEVICE_UNAVAILABLE',
  });
  expect(getOrSet).not.toHaveBeenCalled();
});

it('rejects stored rows with an unknown source and sanitizes raw database failures', async () => {
  const device = await DeviceV2.create(createDeviceInput({ _id: 'source_device' }));
  const bounds = window();
  const reading = createReadingV2Input(device._id, {
    timestamp: new Date(bounds.start),
    quality: { is_valid: true, is_anomaly: true },
  });
  await ReadingV2.collection.insertOne({
    ...reading,
    metadata: { ...reading.metadata, source: 'unexpected-private-source' },
  });
  const ctx = await context();
  const filters = { ...bounds, device_id: device._id, limit: 20 };
  await expect(readPorts.get_readings_window(ctx, filters)).rejects.toMatchObject({
    code: 'INVALID_RESULT',
  });
  await expect(
    readPorts.get_anomalies(ctx, {
      ...bounds,
      device_ids: null,
      min_score: null,
      limit: 20,
    })
  ).rejects.toMatchObject({ code: 'INVALID_RESULT' });

  jest.spyOn(ReadingV2.collection, 'find').mockImplementationOnce(() => {
    throw new Error('private MongoDB failure');
  });
  await expect(readPorts.get_readings_window(ctx, filters)).rejects.toMatchObject({
    code: 'READ_UNAVAILABLE',
    message: expect.not.stringContaining('private'),
  });
});

it('does not turn a non-finite stored anomaly score into a scoreless cached result', async () => {
  const bounds = window();
  const reading = createReadingV2Input('score_device', { timestamp: new Date(bounds.start) });
  await ReadingV2.collection.insertOne({
    ...reading,
    quality: { is_valid: true, is_anomaly: true, anomaly_score: Infinity },
  });

  await expect(
    readPorts.get_anomalies(await context(), {
      ...bounds,
      device_ids: null,
      min_score: null,
      limit: 1,
    })
  ).rejects.toMatchObject({ code: 'INVALID_RESULT' });
});

it('rejects an unrelated device in a cached selected anomaly breakdown', async () => {
  const device = await DeviceV2.create(createDeviceInput({ _id: 'requested_device' }));
  const bounds = window();
  await ReadingV2.create(
    createReadingV2Input(device._id, {
      timestamp: new Date(bounds.start),
      quality: { is_valid: true, is_anomaly: true },
    })
  );

  const ctx = await context();
  const filters = { ...bounds, device_ids: [device._id], min_score: null, limit: 1 };
  await readPorts.get_anomalies(ctx, filters);
  const [entry] = entries;
  const [key, value] = entry;
  const stored = JSON.parse(value);
  stored.data.summary.by_device[0].device_id = 'unrelated_device';
  entries.set(key, JSON.stringify(stored));

  await expect(readPorts.get_anomalies(ctx, filters)).rejects.toMatchObject({
    code: 'INVALID_RESULT',
  });
});
