import { NextRequest } from 'next/server';
import { setTimeout as delay } from 'node:timers/promises';
import { GET as getHealth } from '@/app/api/v2/analytics/health/route';
import { GET as getAnomalies } from '@/app/api/v2/analytics/anomalies/route';
import { GET as getDevices } from '@/app/api/v2/devices/route';
import { GET as getDevice } from '@/app/api/v2/devices/[id]/route';
import { GET as getReadings } from '@/app/api/v2/readings/route';
import * as auth from '@/lib/auth';
import { getOrSet, healthKey } from '@/lib/cache';
import { readHealth } from '@/lib/analytics/health';
import { readAnomalies } from '@/lib/analytics/anomalies';
import { createReadContext } from '@/lib/data/read-context';
import { anomalyAnalyticsQuerySchema } from '@/lib/validations/v2/reading.validation';
import { ApiError } from '@/lib/errors';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import { createDeviceInput, createReadingV2Input } from '../../setup/factories';

jest.mock('@/lib/cache', () => ({ ...jest.requireActual('@/lib/cache'), getOrSet: jest.fn() }));

// Redis round-trips JSON. Keep the real query, key construction and route auth.
const entries = new Map<string, string>();
beforeEach(() => {
  entries.clear();
  jest.mocked(getOrSet).mockImplementation(async (key, fetch) => {
    const cached = entries.get(key);
    if (cached !== undefined) return JSON.parse(cached);
    const data = await fetch();
    entries.set(key, JSON.stringify(data));
    return data;
  });
});
afterEach(() => jest.restoreAllMocks());

function request(path: string, signal?: AbortSignal) {
  return new NextRequest(new URL(path, 'http://localhost'), { signal });
}

it('keeps both health thresholds in the cache identity', async () => {
  const device = createDeviceInput();
  await DeviceV2.create({
    ...device,
    location: { ...device.location, floor: 0 },
    health: { ...device.health, last_seen: new Date(Date.now() - 10 * 60_000), battery_level: 25 },
  });

  for (const [minutes, battery, offlineCount, batteryCount] of [
    [5, 20, 1, 0],
    [15, 20, 0, 0],
    [15, 30, 0, 1],
    [5, 20, 1, 0],
  ]) {
    const url = `/api/v2/analytics/health?floor=0&offline_threshold_minutes=${minutes}&battery_warning_threshold=${battery}`;
    const response = await getHealth(request(url));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.alerts.offline_devices).toMatchObject({
      count: offlineCount,
      threshold_minutes: minutes,
    });
    expect(data.alerts.low_battery_devices).toMatchObject({
      count: batteryCount,
      threshold_percent: battery,
    });
    expect(data).not.toHaveProperty('computedAt');
  }
  expect(entries.size).toBe(3);
});

it.each([
  ['offline_devices', 'threshold_minutes'],
  ['low_battery_devices', 'threshold_percent'],
])('rejects a cached %s count computed with a different threshold', async (category, field) => {
  const scope = await createReadContext('org_test', new AbortController().signal);
  const filters = { offline_threshold_minutes: 5, battery_warning_threshold: 20 };
  await readHealth(scope, filters);
  const key = healthKey(scope, filters);
  const stored = JSON.parse(entries.get(key)!);
  stored.data.alerts[category][field] += 1;
  entries.set(key, JSON.stringify(stored));
  await expect(readHealth(scope, filters)).rejects.toMatchObject({ statusCode: 503 });
});

it('returns floor zero in health evidence and refreshes only the retrieval time on a cache hit', async () => {
  const scope = await createReadContext('org_test', new AbortController().signal);
  const filters = { floor: 0, offline_threshold_minutes: 5, battery_warning_threshold: 20 };
  const first = await readHealth(scope, filters);
  expect(first.data.filters_applied.floor).toBe(0);
  expect(first.data.summary.total_devices).toBe(0);
  expect(first.computedAt).toEqual(expect.any(String));

  const device = createDeviceInput();
  await DeviceV2.create({ ...device, location: { ...device.location, floor: 0 } });
  await delay(2); // Retrieval timestamps have millisecond precision.
  const cached = await readHealth(scope, filters);
  expect(cached.data.summary.total_devices).toBe(0);
  expect(cached.computedAt).toBe(first.computedAt);
  expect(Date.parse(cached.retrievedAt)).toBeGreaterThan(Date.parse(first.retrievedAt));

  const other = await readHealth({ ...scope, datasetId: 'another-dataset' }, filters);
  expect(other.data.summary.total_devices).toBe(1);
});

it.each([
  ['/api/v2/analytics/health', getHealth],
  ['/api/v2/analytics/anomalies', getAnomalies],
  ['/api/v2/devices', getDevices],
] as const)('requires membership before reading a warm cache for %s', async (path, get) => {
  expect((await get(request(path))).status).toBe(200);
  expect(entries.size).toBe(1);
  jest.mocked(getOrSet).mockClear();
  jest
    .spyOn(auth, 'requireOrgMembership')
    .mockRejectedValueOnce(ApiError.forbidden('Access denied'));
  expect((await get(request(path))).status).toBe(403);
  expect(getOrSet).not.toHaveBeenCalled();
});

it('keeps anomaly filter echoes in request order on a shared cache hit', async () => {
  for (const ids of ['a,b', 'b,a']) {
    const response = await getAnomalies(request(`/api/v2/analytics/anomalies?device_id=${ids}`));
    expect(response.status).toBe(200);
    expect((await response.json()).data.filters_applied.device_id).toEqual(ids.split(','));
  }
  expect(entries.size).toBe(1);
});

it('rejects a member requesting an admin-warmed deleted-device list', async () => {
  const path = '/api/v2/devices?only_deleted=true';
  expect((await getDevices(request(path))).status).toBe(200);
  const admin = await auth.requireOrgMembership();
  jest
    .spyOn(auth, 'requireOrgMembership')
    .mockResolvedValueOnce({ ...admin, orgRole: 'org:member' });
  jest.mocked(getOrSet).mockClear();
  expect((await getDevices(request(path))).status).toBe(403);
  expect(getOrSet).not.toHaveBeenCalled();
});

it('passes the five-second limit and client cancellation to each selected MongoDB operation', async () => {
  const id = 'read_deadline_device';
  await DeviceV2.create(createDeviceInput({ _id: id }));
  const operations = [
    jest.spyOn(DeviceV2.collection, 'find'),
    jest.spyOn(DeviceV2.collection, 'findOne'),
    jest.spyOn(DeviceV2.collection, 'countDocuments'),
    jest.spyOn(DeviceV2.collection, 'aggregate'),
    jest.spyOn(ReadingV2.collection, 'find'),
    jest.spyOn(ReadingV2.collection, 'countDocuments'),
    jest.spyOn(ReadingV2.collection, 'aggregate'),
  ];
  const client = new AbortController();
  const requests = [
    '/api/v2/devices',
    `/api/v2/devices/${id}?include_recent_readings=true`,
    `/api/v2/readings?device_id=${id}`,
    '/api/v2/analytics/health',
    '/api/v2/analytics/anomalies?bucket_granularity=hour',
  ].map(path => request(path, client.signal));
  const responses = [
    await getDevices(requests[0]),
    await getDevice(requests[1], { params: Promise.resolve({ id }) }),
    await getReadings(requests[2]),
    await getHealth(requests[3]),
    await getAnomalies(requests[4]),
  ];
  expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200]);
  client.abort();
  expect(requests.every(request => request.signal.aborted)).toBe(true);
  for (const operation of operations) {
    expect(operation).toHaveBeenCalled();
    for (const [, options] of operation.mock.calls) {
      expect(options?.maxTimeMS).toBe(5000);
      expect(options?.signal?.aborted).toBe(true);
    }
  }
});

it('discards cached evidence if the caller disconnects during retrieval', async () => {
  const client = new AbortController();
  const scope = await createReadContext('org_test', client.signal);
  const filters = { offline_threshold_minutes: 5, battery_warning_threshold: 20 };
  await readHealth(scope, filters);
  jest.mocked(getOrSet).mockImplementationOnce(async key => {
    client.abort(new Error('request cancelled'));
    return JSON.parse(entries.get(key)!);
  });
  await expect(readHealth(scope, filters)).rejects.toThrow('request cancelled');
});

it('gives MongoDB a fresh query budget after a slow cache miss', async () => {
  const deadlines: AbortController[] = [];
  jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const deadline = new AbortController();
    deadlines.push(deadline);
    return deadline.signal;
  });
  const scope = await createReadContext('org_test', new AbortController().signal);
  jest.mocked(getOrSet).mockImplementationOnce(async (_key, compute) => {
    // The optional cache took longer than the DB allowance before reporting a miss.
    for (const deadline of deadlines) deadline.abort(new Error('deadline expired'));
    return compute();
  });
  const result = await readHealth(scope, {
    offline_threshold_minutes: 5,
    battery_warning_threshold: 20,
  });
  expect(result.data.summary.total_devices).toBe(0);
});

it('returns the same JSON timestamps and document IDs on a cold and warm read', async () => {
  const timestamp = new Date();
  const row = await ReadingV2.create(
    createReadingV2Input('snapshot_device', {
      timestamp,
      quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.8, confidence_score: 1 },
    })
  );
  const scope = await createReadContext('org_test', new AbortController().signal);
  const query = anomalyAnalyticsQuerySchema.parse({ startDate: timestamp });
  const expected = { _id: row._id.toString(), timestamp: timestamp.toISOString() };
  const cold = await readAnomalies(scope, query);
  const warm = await readAnomalies(scope, query);
  expect(cold.data.anomalies[0]).toMatchObject(expected);
  expect(cold.data.filters_applied.time_range.start).toBe(timestamp.toISOString());
  expect(cold.data).toStrictEqual(warm.data);
});
