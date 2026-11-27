import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { createAssistantTools } from '@/lib/assistant/tools';
import * as readContext from '@/lib/data/read-context';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import { createDeviceInput, createReadingV2Input } from '../setup/factories';

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
  clerkClient: jest.fn(),
}));

const mockMembershipLookup = jest.fn();
const pilotUser = 'user_assistant_pilot';
const pilotOrg = 'org_assistant_pilot';
const dataset = 'assistant-integration-dataset';
const floor = { building_id: 'building_001', floor: 0 };
const deviceId = 'temperature_lobby';
const secondId = 'temperature_hall';
const outsideId = 'temperature_upstairs';
const removedId = 'temperature_removed';

function setClerkSession(userId: string | null, orgId: string | null) {
  jest.mocked(auth).mockResolvedValue({
    userId,
    orgId,
    orgSlug: userId ? 'users' : null,
    orgRole: userId ? 'org:member' : null,
  } as Awaited<ReturnType<typeof auth>>);
  jest.mocked(currentUser).mockResolvedValue(
    userId
      ? ({
          id: userId,
          fullName: 'Pilot Member',
          firstName: 'Pilot',
          lastName: 'Member',
          primaryEmailAddressId: 'email_1',
          emailAddresses: [{ id: 'email_1', emailAddress: 'pilot@example.invalid' }],
        } as Awaited<ReturnType<typeof currentUser>>)
      : null
  );
}

beforeEach(() => {
  jest.replaceProperty(process, 'env', {
    ...process.env,
    ASSISTANT_ENABLED: 'true',
    ASSISTANT_ALLOWED_ORG_ID: pilotOrg,
    ASSISTANT_ALLOWED_USER_IDS: pilotUser,
    ASSISTANT_DATASET_ID: dataset,
    CLERK_ALLOWED_ORG_SLUGS: 'users',
    DEMO_MODE: 'false',
    CACHE_ENABLED: 'false',
  });
  delete process.env.REDIS_URL;
  setClerkSession(pilotUser, pilotOrg);
  jest.mocked(clerkClient).mockResolvedValue({
    organizations: { getOrganizationMembershipList: mockMembershipLookup },
  } as unknown as Awaited<ReturnType<typeof clerkClient>>);
  mockMembershipLookup.mockReset().mockResolvedValue({
    data: [
      { role: 'org:member', organization: { id: pilotOrg }, publicUserData: { userId: pilotUser } },
    ],
    totalCount: 1,
  });
});

afterEach(() => jest.restoreAllMocks());

it('executes all five tools with scoped evidence from the seeded floor', async () => {
  const now = Date.now();
  const firstReading = new Date(now - 8 * 60_000);
  const flaggedReading = new Date(now - 7 * 60_000);
  const location = { ...floor, room_name: 'Lobby' };
  await DeviceV2.create([
    createDeviceInput({ _id: deviceId, serial_number: 'SN-001', location }),
    createDeviceInput({
      _id: secondId,
      serial_number: 'SN-002',
      location: { ...floor, room_name: 'Hall' },
      status: 'error',
      health: {
        last_seen: firstReading,
        battery_level: 18,
        error_count: 2,
        last_error: {
          message: 'internal-error-details',
          code: 'INTERNAL',
          timestamp: firstReading,
        },
      },
    }),
    createDeviceInput({ _id: outsideId, location: { ...location, floor: 1 } }),
    createDeviceInput({
      _id: removedId,
      location,
      audit: { deleted_at: flaggedReading, deleted_by: 'internal-delete-actor' },
    }),
  ]);
  const flags = { is_valid: false, is_anomaly: true, anomaly_score: 0 };
  await ReadingV2.create([
    createReadingV2Input(deviceId, {
      timestamp: firstReading,
      value: 21,
      quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.8 },
    }),
    createReadingV2Input(deviceId, {
      timestamp: flaggedReading,
      value: 28,
      metadata: { device_id: deviceId, unit: 'celsius', type: 'temperature', source: 'simulation' },
      quality: { ...flags, validation_flags: ['internal-validation-flag'] },
    }),
    createReadingV2Input(deviceId, { timestamp: new Date(now - 6 * 60_000), value: 22 }),
    createReadingV2Input(outsideId, { timestamp: flaggedReading, quality: flags }),
    createReadingV2Input(removedId, { timestamp: flaggedReading, quality: flags }),
  ]);

  const { scope, executeReadTool } = await createAssistantTools();
  const signal = new AbortController().signal;
  const search = { ...floor, search: null, type: null, limit: 20 };
  const devices = await executeReadTool('find_devices', JSON.stringify(search), signal);
  const population = { kind: 'location', ...floor };

  expect(devices).toMatchObject({
    name: 'find_devices',
    route: '/api/v2/devices',
    href: '/devices',
    population,
    snapshot: { data: { total: 2, returned: 2, truncated: false } },
  });
  if (devices.name !== 'find_devices') throw new Error('Expected the device search result');
  const ids = devices.snapshot.data.rows.map(row => row.id);
  expect(ids).toEqual([deviceId, secondId]);

  const detail = await executeReadTool(
    'get_device',
    JSON.stringify({ device_id: secondId }),
    signal
  );
  expect(detail).toMatchObject({
    route: '/api/v2/devices/[id]',
    href: `/devices/${secondId}`,
    population: { kind: 'device', device_id: secondId },
    snapshot: { data: { id: secondId, status: 'error', battery_level: 18, error_count: 2 } },
  });

  const readings = await executeReadTool(
    'get_readings_window',
    JSON.stringify({
      device_id: deviceId,
      start: firstReading.toISOString(),
      end: scope.asOf,
      limit: 2,
    }),
    signal
  );
  expect(readings).toMatchObject({
    route: '/api/v2/readings',
    href: `/devices/${deviceId}`,
    population: { kind: 'device', device_id: deviceId },
    snapshot: {
      data: {
        total: 3,
        returned: 2,
        truncated: true,
        rows: [
          { value: 21, source: 'sensor', is_valid: true, unit: 'celsius' },
          { value: 28, source: 'simulation', is_valid: false, is_anomaly: true, anomaly_score: 0 },
        ],
      },
    },
    limitations: expect.arrayContaining([
      'READING_ROWS_PARTIAL',
      'RETURNED_ROWS_SIMULATED',
      'MIXED_READING_SOURCES',
      'RETURNED_ROW_INVALID',
    ]),
  });

  const health = await executeReadTool('get_health_summary', JSON.stringify(floor), signal);
  expect(health).toMatchObject({
    route: '/api/v2/analytics/health',
    href: '/analytics',
    population,
    filters: { ...floor, offline_threshold_minutes: 5, battery_warning_threshold: 20 },
    snapshot: {
      data: {
        total_devices: 2,
        active_devices: 1,
        health_score: 50,
        devices_with_issues: 1,
        low_battery: { count: 1, sample: [{ id: secondId, battery_level: 18 }] },
      },
    },
  });

  const anomalies = await executeReadTool(
    'get_anomalies',
    JSON.stringify({ device_ids: ids, start: null, end: null, min_score: 0, limit: 2 }),
    signal
  );
  expect(anomalies).toMatchObject({
    route: '/api/v2/analytics/anomalies',
    href: '/analytics',
    population,
    filters: { device_ids: [...ids].sort(), end: scope.asOf, min_score: 0 },
    resolution: { filters: search, total: 2 },
    snapshot: {
      data: {
        total: 2,
        returned: 2,
        truncated: false,
        rows: [
          { device_id: deviceId, source: 'simulation', is_valid: false, anomaly_score: 0 },
          { device_id: deviceId, source: 'sensor', is_valid: true, anomaly_score: 0.8 },
        ],
        includes_invalid: true,
        includes_deleted_or_missing_devices: false,
      },
    },
    limitations: expect.arrayContaining([
      'COHORT_AS_OF_DEVICE_SEARCH',
      'RETURNED_ROWS_SIMULATED',
      'MIXED_READING_SOURCES',
      'RETURNED_ROW_INVALID',
    ]),
  });

  const evidence = JSON.stringify([devices, detail, readings, health, anomalies]);
  for (const excluded of [pilotUser, pilotOrg, dataset, 'CC-001', 'internal-'])
    expect(evidence).not.toContain(excluded);
  for (const read of [devices, detail, readings, health, anomalies])
    expect(Date.parse(read.snapshot.retrievedAt)).toBeGreaterThanOrEqual(Date.parse(scope.asOf));
});

it.each([
  { caller: 'anonymous', userId: null, orgId: null, statusCode: 401 },
  { caller: 'synthetic demo', userId: null, orgId: null, statusCode: 401, demo: true },
  { caller: 'wrong organization', userId: pilotUser, orgId: 'org_other', statusCode: 403 },
  { caller: 'missing organization', userId: pilotUser, orgId: null, statusCode: 403 },
  { caller: 'non-pilot member', userId: 'user_other', orgId: pilotOrg, statusCode: 403 },
  {
    caller: 'pilot member when disabled',
    userId: pilotUser,
    orgId: pilotOrg,
    statusCode: 503,
    disabled: true,
  },
])(
  'denies $caller before creating a read context',
  async ({ userId, orgId, statusCode, demo, disabled }) => {
    setClerkSession(userId, orgId);
    if (demo) process.env.DEMO_MODE = 'true';
    if (disabled) process.env.ASSISTANT_ENABLED = 'false';
    const connectForRead = jest.spyOn(readContext, 'createReadContext');

    await expect(createAssistantTools()).rejects.toMatchObject({ statusCode });
    expect(connectForRead).not.toHaveBeenCalled();
    expect(mockMembershipLookup).not.toHaveBeenCalled();
  }
);

it('checks the current Clerk organization before querying an established session', async () => {
  const { executeReadTool } = await createAssistantTools();
  setClerkSession(pilotUser, 'org_other');
  const connectForRead = jest.spyOn(readContext, 'createReadContext');

  await expect(
    executeReadTool(
      'get_device',
      JSON.stringify({ device_id: deviceId }),
      new AbortController().signal
    )
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(connectForRead).not.toHaveBeenCalled();
});

it('stops further reads after Clerk removes membership while the request token still grants access', async () => {
  await DeviceV2.create(createDeviceInput({ _id: deviceId }));
  const { executeReadTool } = await createAssistantTools();
  const signal = new AbortController().signal;
  const args = JSON.stringify({ device_id: deviceId });
  const connectForRead = jest.spyOn(readContext, 'createReadContext');

  await expect(executeReadTool('get_device', args, signal)).resolves.toMatchObject({
    snapshot: { data: { id: deviceId } },
  });
  expect(connectForRead).toHaveBeenCalledTimes(1);
  connectForRead.mockClear();

  // Keep the request's signed-in claims and allowed role exactly as they were.
  mockMembershipLookup.mockResolvedValue({ data: [], totalCount: 0 });
  await expect(executeReadTool('get_device', args, signal)).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(connectForRead).not.toHaveBeenCalled();
});
