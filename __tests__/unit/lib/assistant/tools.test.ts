import { ApiError } from '@/lib/errors';
import { createReadContext } from '@/lib/data/read-context';
import { requireAssistantContext, reauthorizeAssistant } from '@/lib/assistant/access';
import { readPorts } from '@/lib/assistant/read-ports';
import { createAssistantTools } from '@/lib/assistant/tools';

jest.mock('@/lib/cache', () => ({
  CACHE_TTL: { DEVICES_LIST: 30, HEALTH: 600, ANOMALIES: 10 },
}));
jest.mock('@/lib/assistant/access', () => ({
  requireAssistantContext: jest.fn(),
  reauthorizeAssistant: jest.fn(),
}));
jest.mock('@/lib/data/read-context', () => ({ createReadContext: jest.fn() }));
jest.mock('@/lib/assistant/read-ports', () => ({
  readPorts: {
    find_devices: jest.fn(),
    get_health_summary: jest.fn(),
    get_anomalies: jest.fn(),
    get_device: jest.fn(),
    get_readings_window: jest.fn(),
  },
}));

const asOf = '2026-11-25T15:20:00.000Z';
const scope = {
  sessionId: 'pilot_session',
  userId: 'pilot_user',
  orgId: 'pilot_org',
  datasetId: 'dedicated',
  asOf,
  policyVersion: 'test',
};
const search = { search: null, type: null, building_id: 'main', floor: 0, limit: 20 };
const anomalies = { device_ids: null, start: null, end: null, min_score: 0, limit: 2 };
const signal = () => new AbortController().signal;
const snapshot = <T>(data: T) => ({ data, computedAt: asOf, retrievedAt: asOf });
const device = (id: string) => ({
  id,
  serial_number: id,
  type: 'temperature' as const,
  building_id: 'main',
  floor: 0,
  room_name: 'Server Room',
  status: 'active' as const,
});
function searchPage(ids: string[], total = ids.length) {
  return snapshot({
    rows: ids.map(device),
    total,
    returned: ids.length,
    truncated: total > ids.length,
  });
}
const emptyAnomalies = {
  rows: [],
  total: 0,
  returned: 0,
  truncated: false,
  by_device: [],
  breakdown_limit: 10 as const,
  includes_invalid: true as const,
  includes_deleted_or_missing_devices: false,
};

const emptyHealth = {
  total_devices: 0,
  active_devices: 0,
  health_score: 100,
  devices_with_issues: 0,
  offline: { count: 0, threshold_minutes: 5 as const, sample: [] },
  low_battery: { count: 0, threshold_percent: 20 as const, sample: [] },
  error: { count: 0, sample: [] },
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(asOf));
  jest.mocked(requireAssistantContext).mockResolvedValue(scope);
  jest.mocked(reauthorizeAssistant).mockResolvedValue(undefined);
  jest
    .mocked(createReadContext)
    .mockImplementation(async (orgId, signal) => ({ orgId, datasetId: scope.datasetId, signal }));
  jest.mocked(readPorts.get_anomalies).mockResolvedValue(snapshot(emptyAnomalies));
});
afterEach(() => jest.restoreAllMocks());

it('returns a proven empty floor locally, without issuing a fleet anomaly read', async () => {
  jest.mocked(readPorts.find_devices).mockResolvedValue(searchPage([]));
  const session = await createAssistantTools();
  await session.executeReadTool('find_devices', JSON.stringify(search), signal());
  jest.mocked(createReadContext).mockClear();
  const result = await session.executeReadTool(
    'get_anomalies',
    JSON.stringify(anomalies),
    signal()
  );
  expect(result).toMatchObject({
    population: { kind: 'location', building_id: 'main', floor: 0 },
    filters: { device_ids: [], start: '2026-11-24T15:20:00.000Z', end: asOf, min_score: 0 },
    resolution: { filters: search, total: 0 },
    snapshot: { data: { total: 0, rows: [] } },
  });
  expect(result.limitations).toContain('EMPTY_COHORT');
  expect(readPorts.get_anomalies).not.toHaveBeenCalled();
  expect(createReadContext).not.toHaveBeenCalled();
});

it.each([
  [21, 'SCOPE_TOO_LARGE'],
  [3, 'INCOMPLETE_COHORT'],
] as const)(
  'refuses to treat the first page of a %i-device floor as its full population',
  async (total, code) => {
    jest.mocked(readPorts.find_devices).mockResolvedValue(searchPage(['a', 'b'], total));
    const session = await createAssistantTools();
    await session.executeReadTool(
      'find_devices',
      JSON.stringify({ ...search, limit: 2 }),
      signal()
    );
    for (const device_ids of [null, ['b', 'a']])
      await expect(
        session.executeReadTool(
          'get_anomalies',
          JSON.stringify({ ...anomalies, device_ids }),
          signal()
        )
      ).rejects.toMatchObject({ code });

    expect(readPorts.get_anomalies).not.toHaveBeenCalled();
    const subset = await session.executeReadTool(
      'get_anomalies',
      JSON.stringify({ ...anomalies, device_ids: ['a'] }),
      signal()
    );
    expect(subset.population).toEqual({ kind: 'device_subset', device_ids: ['a'] });
  }
);

it.each([
  [null, null, 'location'],
  ['server', null, 'filtered_devices'],
  [null, 'temperature', 'filtered_devices'],
])('binds a complete cohort to search %p and type %p', async (term, type, kind) => {
  const filters = { ...search, type, search: term };
  jest.mocked(readPorts.find_devices).mockResolvedValue(searchPage(['b', 'a']));
  const session = await createAssistantTools();
  await session.executeReadTool('find_devices', JSON.stringify(filters), signal());
  const result = await session.executeReadTool(
    'get_anomalies',
    JSON.stringify({ ...anomalies, device_ids: ['b', 'a'] }),
    signal()
  );
  expect(result).toMatchObject({
    population: { kind, floor: 0 },
    filters: { device_ids: ['a', 'b'], min_score: 0 },
    resolution: { filters, total: 2 },
  });
});

it('keeps fleet evidence separate from other requests and includes its legacy-device limitation', async () => {
  jest.mocked(readPorts.find_devices).mockResolvedValue(searchPage([]));
  const first = await createAssistantTools();
  await first.executeReadTool('find_devices', JSON.stringify(search), signal());
  jest
    .mocked(readPorts.get_anomalies)
    .mockResolvedValue(snapshot({ ...emptyAnomalies, includes_deleted_or_missing_devices: true }));
  const second = await createAssistantTools();
  const fleet = await second.executeReadTool('get_anomalies', JSON.stringify(anomalies), signal());
  expect(fleet.population).toEqual({ kind: 'dataset' });
  expect(fleet.limitations).toContain('ANOMALY_SCOPE_MAY_INCLUDE_DELETED_OR_MISSING_DEVICES');
  expect(fleet).not.toHaveProperty('resolution');
  for (const secret of [scope.userId, scope.orgId, scope.datasetId])
    expect(JSON.stringify(fleet)).not.toContain(secret);
});

it('rechecks pilot access before every read and invalidates the session after revocation', async () => {
  const session = await createAssistantTools();
  jest.mocked(reauthorizeAssistant).mockRejectedValueOnce(ApiError.forbidden());
  for (let i = 0; i < 2; i++)
    await expect(
      session.executeReadTool('get_device', '{"device_id":"a"}', signal())
    ).rejects.toMatchObject({ statusCode: 403 });
  expect(createReadContext).not.toHaveBeenCalled();
  expect(readPorts.get_device).not.toHaveBeenCalled();
});

it('refuses the database read when the connected dataset changes', async () => {
  const session = await createAssistantTools();
  jest
    .mocked(createReadContext)
    .mockResolvedValueOnce({ orgId: scope.orgId, datasetId: 'replacement', signal: signal() });
  await expect(
    session.executeReadTool('get_device', '{"device_id":"a"}', signal())
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    session.executeReadTool('find_devices', JSON.stringify(search), signal())
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(createReadContext).toHaveBeenCalledTimes(1);
  expect(readPorts.get_device).not.toHaveBeenCalled();
  expect(readPorts.find_devices).not.toHaveBeenCalled();
});

it('rejects an oversized result and keeps a failed search from widening the next read', async () => {
  const large = searchPage(['a']);
  large.data.rows[0].room_name = '測'.repeat(2400);
  jest.mocked(readPorts.find_devices).mockResolvedValue(large);
  const session = await createAssistantTools();
  await expect(
    session.executeReadTool('find_devices', JSON.stringify(search), signal())
  ).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
  await expect(
    session.executeReadTool('get_anomalies', JSON.stringify(anomalies), signal())
  ).rejects.toMatchObject({ code: 'INCOMPLETE_COHORT' });
  expect(readPorts.get_anomalies).not.toHaveBeenCalled();
});

it('rejects duplicate and empty IDs and unknown tools before database access; invalid proposals count toward six attempts', async () => {
  const session = await createAssistantTools();
  for (const device_ids of [[], ['a', 'a']])
    await expect(
      session.executeReadTool(
        'get_anomalies',
        JSON.stringify({ ...anomalies, device_ids }),
        signal()
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  for (let i = 0; i < 4; i++)
    await expect(session.executeReadTool('toString', '{}', signal())).rejects.toMatchObject({
      code: 'UNKNOWN_TOOL',
    });
  await expect(
    session.executeReadTool('get_device', '{"device_id":"a"}', signal())
  ).rejects.toMatchObject({ code: 'TOOL_LIMIT' });
  expect(createReadContext).not.toHaveBeenCalled();
});

it('keeps proposals in order when a queued call is cancelled during a device search', async () => {
  const started = Promise.withResolvers<void>();
  const searchResult = Promise.withResolvers<ReturnType<typeof searchPage>>();
  jest.mocked(readPorts.find_devices).mockImplementationOnce(() => {
    started.resolve();
    return searchResult.promise;
  });
  const session = await createAssistantTools();
  const first = session.executeReadTool('find_devices', JSON.stringify(search), signal());
  await started.promise;
  const caller = new AbortController();
  const cancelled = session.executeReadTool('get_device', '{"device_id":"a"}', caller.signal);
  caller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  const following = session
    .executeReadTool('get_anomalies', JSON.stringify(anomalies), signal())
    .catch((error: unknown) => error);
  await new Promise<void>(resolve => setImmediate(resolve));
  searchResult.resolve(searchPage([]));
  await first;
  await expect(following).resolves.toMatchObject({
    population: { kind: 'location', floor: 0 },
    limitations: expect.arrayContaining(['EMPTY_COHORT']),
  });
  expect(readPorts.get_anomalies).not.toHaveBeenCalled();
  expect(readPorts.get_device).not.toHaveBeenCalled();
});

it('limits cumulative UTF-8 bytes for all successful results of one question', async () => {
  const large = searchPage(Array.from({ length: 17 }, (_, i) => 'device-' + i));
  for (const row of large.data.rows) row.room_name = '測'.repeat(55);
  jest.mocked(readPorts.find_devices).mockResolvedValue(large);
  const session = await createAssistantTools();
  const run = () => session.executeReadTool('find_devices', JSON.stringify(search), signal());
  const result = await run();
  const size = Buffer.byteLength(JSON.stringify(result), 'utf8');
  expect(size).toBeLessThanOrEqual(6 * 1024);
  const capacity = Math.floor((24 * 1024) / size);
  expect(capacity).toBeLessThan(6);
  for (let i = 1; i < capacity; i++) await run();
  await expect(run()).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
});

it('discards results when access is revoked while the database read is in flight', async () => {
  const session = await createAssistantTools();
  jest.mocked(readPorts.find_devices).mockResolvedValue(searchPage(['a']));
  jest
    .mocked(reauthorizeAssistant)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(ApiError.forbidden());
  await expect(
    session.executeReadTool('find_devices', JSON.stringify(search), signal())
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    session.executeReadTool('get_anomalies', JSON.stringify(anomalies), signal())
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(readPorts.get_anomalies).not.toHaveBeenCalled();
});

it('bounds a slow authorization check and ignores its late failure after the deadline', async () => {
  const started = Promise.withResolvers<void>();
  const late = Promise.withResolvers<void>();
  const deadline = new AbortController();
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
  try {
    jest.mocked(reauthorizeAssistant).mockImplementationOnce(() => {
      started.resolve();
      return late.promise;
    });
    const session = await createAssistantTools();
    const slow = session.executeReadTool('find_devices', JSON.stringify(search), signal());
    await started.promise;
    expect(timeout).toHaveBeenCalledWith(8_000);
    deadline.abort();
    await expect(slow).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' });
    await expect(
      session.executeReadTool('get_anomalies', JSON.stringify(anomalies), signal())
    ).rejects.toMatchObject({ code: 'INCOMPLETE_COHORT' });
    expect(readPorts.get_anomalies).not.toHaveBeenCalled();
    late.reject(ApiError.forbidden());
    await new Promise<void>(resolve => setImmediate(resolve));
    jest.mocked(readPorts.find_devices).mockResolvedValueOnce(searchPage(['a']));
    await expect(
      session.executeReadTool('find_devices', JSON.stringify(search), signal())
    ).resolves.toMatchObject({ snapshot: { data: { total: 1 } } });
    expect(readPorts.find_devices).toHaveBeenCalledTimes(1);
  } finally {
    timeout.mockRestore();
  }
});

it('marks the cohort age unknown when a search cache timestamp is ahead of retrieval', async () => {
  const future = '2026-11-26T15:20:00.000Z';
  jest
    .mocked(readPorts.find_devices)
    .mockResolvedValue({ ...searchPage(['a']), computedAt: future });
  const session = await createAssistantTools();
  const devices = await session.executeReadTool('find_devices', JSON.stringify(search), signal());
  expect(devices.limitations).toContain('UNKNOWN_FRESHNESS');
  const result = await session.executeReadTool(
    'get_anomalies',
    JSON.stringify({ ...anomalies, device_ids: ['a'] }),
    signal()
  );
  expect(result.limitations).toContain('COHORT_FRESHNESS_LIMITED');
});

it('preserves both source timestamps and unknown freshness when deriving an empty result locally', async () => {
  const retrievedAt = '2026-11-25T15:20:00.000Z';
  const computedAt = '2026-11-25T15:20:01.000Z';
  jest
    .mocked(readPorts.find_devices)
    .mockResolvedValue({ ...searchPage([]), computedAt, retrievedAt });
  const session = await createAssistantTools();
  await session.executeReadTool('find_devices', JSON.stringify(search), signal());
  const result = await session.executeReadTool(
    'get_anomalies',
    JSON.stringify(anomalies),
    signal()
  );
  expect(result.snapshot).toMatchObject({ computedAt, retrievedAt });
  expect(result.limitations).toContain('UNKNOWN_FRESHNESS');
  expect(readPorts.get_anomalies).not.toHaveBeenCalled();
});

it('declines health evidence past 60 seconds even with a ten-minute source TTL', async () => {
  const health = jest.mocked(readPorts.get_health_summary);
  const args = JSON.stringify({ building_id: null, floor: null });
  const { executeReadTool } = await createAssistantTools();
  const read = () => executeReadTool('get_health_summary', args, signal());
  const computed = (age: number) => new Date(Date.parse(asOf) - age).toISOString();
  health.mockResolvedValueOnce({ ...snapshot(emptyHealth), computedAt: computed(60_000) });
  await expect(read()).resolves.toMatchObject({ snapshot: { data: emptyHealth } });
  health.mockResolvedValueOnce({ ...snapshot(emptyHealth), computedAt: computed(9 * 60_000) });
  await expect(read()).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
});

it('enforces a shorter anomaly source TTL through the final authorization check', async () => {
  const result = { ...emptyAnomalies, includes_deleted_or_missing_devices: true };
  jest.mocked(readPorts.get_anomalies).mockResolvedValue({
    ...snapshot(result),
    computedAt: new Date(Date.parse(asOf) - 10_000).toISOString(),
  });
  const { executeReadTool } = await createAssistantTools();
  const read = () => executeReadTool('get_anomalies', JSON.stringify(anomalies), signal());
  await expect(read()).resolves.toMatchObject({ snapshot: { data: result } });
  jest
    .mocked(reauthorizeAssistant)
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(async () => {
      jest.mocked(Date.now).mockReturnValue(Date.parse(asOf) + 1);
    });
  await expect(read()).rejects.toMatchObject({ code: 'READ_UNAVAILABLE' });
});

it.each([[], ['a']].map(ids => ({ ids })))(
  'expires a search for $ids when its cohort is reused',
  async ({ ids }) => {
    const retrievedAt = asOf;
    const computedAt = new Date(Date.parse(asOf) - 29_000).toISOString();
    jest
      .mocked(readPorts.find_devices)
      .mockResolvedValue({ ...searchPage(ids), computedAt, retrievedAt });
    const { executeReadTool } = await createAssistantTools();
    await executeReadTool('find_devices', JSON.stringify(search), signal());
    const args = JSON.stringify({ ...anomalies, device_ids: ids.length ? ids : null });
    const accepted = await executeReadTool('get_anomalies', args, signal());
    expect(accepted.resolution).toMatchObject({ computedAt, retrievedAt });
    jest.mocked(Date.now).mockReturnValue(Date.parse(asOf) + 4_000);
    await expect(executeReadTool('get_anomalies', args, signal())).rejects.toMatchObject({
      code: 'READ_UNAVAILABLE',
    });
    if (!ids.length) expect(readPorts.get_anomalies).not.toHaveBeenCalled();
  }
);
