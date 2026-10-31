import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import dbConnect from '@/lib/db';
import ReadingV2 from '@/models/v2/ReadingV2';
import { GET as latest } from '@/app/api/v2/readings/latest/route';

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
}));

// Exercise the real cache-aside module, replacing only Redis's network boundary.
// Atomic Lua behavior has its own unit and opt-in real-Redis integration suites.
const mockStore = new Map<string, { value: string; expires: number }>();
let mockRedisAvailable = true;
const mockRedis = {
  get: jest.fn(async (key: string) => {
    const item = mockStore.get(key);
    return item && item.expires > Date.now() ? item.value : null;
  }),
  eval: jest.fn(
    async (
      _script: string,
      _count: number,
      key: string,
      _epoch: string,
      ttl: string,
      value: string
    ) => {
      mockStore.set(key, { value, expires: Date.now() + Number(ttl) * 1000 });
      return 1;
    }
  ),
};
jest.mock('@/lib/redis/client', () => ({
  getRedisClient: () => mockRedis,
  isRedisAvailable: () => mockRedisAvailable,
}));

function authenticate(orgId = 'org_default') {
  jest
    .mocked(auth)
    .mockResolvedValue({
      userId: 'user_test_default',
      orgId,
      orgSlug: 'users',
      orgRole: 'org:admin',
    } as Awaited<ReturnType<typeof auth>>);
}

function request(params: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/v2/readings/latest?${new URLSearchParams(params)}`);
}

describe('latest readings cache boundary', () => {
  let aggregate: jest.SpiedFunction<typeof ReadingV2.aggregate>;
  beforeEach(() => {
    authenticate();
    mockStore.clear();
    mockRedisAvailable = true;
    aggregate = jest
      .spyOn(ReadingV2, 'aggregate')
      .mockResolvedValue([
        {
          device_id: 'device_001',
          type: 'temperature',
          value: 21,
          timestamp: new Date('2026-10-31T10:00:00Z'),
        },
      ]);
  });
  afterEach(() => {
    aggregate.mockRestore();
  });

  it('reuses the response for ten seconds without reconnecting to MongoDB', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const first = await (await latest(request())).json();
      aggregate.mockResolvedValue([{ device_id: 'device_001', value: 25 }]);
      clock.mockReturnValue(now + 9999);
      expect((await (await latest(request())).json()).data).toEqual(first.data);
      expect(aggregate).toHaveBeenCalledTimes(1);
      expect(dbConnect).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(now + 10001);
      expect((await (await latest(request())).json()).data.readings[0].value).toBe(25);
      expect(aggregate).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('authenticates even when a matching snapshot is cached', async () => {
    await latest(request());
    jest.mocked(auth).mockResolvedValue({ userId: null } as Awaited<ReturnType<typeof auth>>);
    expect((await latest(request())).status).toBe(401);
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it('separates organizations and invalid-reading/quality options', async () => {
    await latest(request({ device_ids: 'device_001' }));
    await latest(request({ device_ids: 'device_001', include_invalid: 'true' }));
    const metrics = await (
      await latest(request({ device_ids: 'device_001', include_quality_metrics: 'true' }))
    ).json();
    expect(metrics.data.quality_metrics).toBeDefined();
    authenticate('org_other');
    await latest(request({ device_ids: 'device_001' }));
    expect(aggregate).toHaveBeenCalledTimes(5);
    // All four variants must independently hit cache on a second visit.
    await latest(request({ device_ids: 'device_001' }));
    authenticate();
    await latest(request({ device_ids: 'device_001' }));
    await latest(request({ device_ids: 'device_001', include_invalid: 'true' }));
    await latest(request({ device_ids: 'device_001', include_quality_metrics: 'true' }));
    expect(aggregate).toHaveBeenCalledTimes(5);
  });

  it('canonicalizes reordered and duplicated filters without sharing different types', async () => {
    await latest(request({ device_ids: 'device_002,device_001', type: 'temperature,humidity' }));
    await latest(
      request({ device_ids: 'device_001,device_002,device_001', type: 'humidity,temperature' })
    );
    expect(aggregate).toHaveBeenCalledTimes(1);
    await latest(request({ device_ids: 'device_001,device_002', type: 'temperature' }));
    expect(aggregate).toHaveBeenCalledTimes(2);
  });

  it('falls back to MongoDB while Redis is unavailable', async () => {
    mockRedisAvailable = false;
    expect((await latest(request())).status).toBe(200);
    expect((await latest(request())).status).toBe(200);
    expect(aggregate).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed aggregates or connect for invalid requests', async () => {
    aggregate.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await latest(request())).status).toBe(500);
    expect((await latest(request())).status).toBe(200);
    expect(aggregate).toHaveBeenCalledTimes(2);
    jest.mocked(dbConnect).mockClear();
    expect((await latest(new NextRequest('http://localhost/api/v2/readings/latest?type=not-a-type&type=also-invalid'))).status).toBe(400);
    expect(dbConnect).not.toHaveBeenCalled();
  });
});
