import { randomUUID } from 'node:crypto';
import { readHealth } from '@/lib/analytics/health';
import { healthKey, invalidateHealthCache } from '@/lib/cache';
import { createReadContext } from '@/lib/data/read-context';
import { closeRedisConnection, getRedisClient } from '@/lib/redis/client';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createDeviceInput } from '../setup/factories';

// Like cache-commit-script.redis.test.ts, this uses a real Redis only on opt-in.
const testWithRedis = process.env.REDIS_TEST_URL ? it : it.skip;

testWithRedis(
  'isolates health thresholds and invalidates legacy and versioned Redis entries',
  async () => {
    const scope = await createReadContext(`test-${randomUUID()}`, new AbortController().signal);
    const normal = { floor: 0, offline_threshold_minutes: 5, battery_warning_threshold: 20 };
    const custom = { ...normal, offline_threshold_minutes: 15, battery_warning_threshold: 30 };
    const legacyKey = `org:${scope.orgId}:health:floor:0`;
    const keys = [legacyKey, healthKey(scope, normal), healthKey(scope, custom)];
    const env = jest.replaceProperty(process, 'env', {
      ...process.env,
      REDIS_URL: process.env.REDIS_TEST_URL,
      CACHE_ENABLED: 'true',
    });
    const redis = getRedisClient()!;
    try {
      await redis.ping();
      await redis.set(legacyKey, JSON.stringify({ summary: { total_devices: 999 } }), 'EX', 60);
      const first = await readHealth(scope, normal);
      expect(first.data.summary.total_devices).toBe(0);
      const stored = JSON.parse((await redis.get(keys[1]))!);
      expect(stored.computedAt).toBe(first.computedAt);
      expect(stored).not.toHaveProperty('retrievedAt');

      const device = createDeviceInput();
      await DeviceV2.create({ ...device, location: { ...device.location, floor: 0 } });
      const cached = await readHealth(scope, normal);
      expect(cached.data.summary.total_devices).toBe(0);
      expect(cached.computedAt).toBe(first.computedAt);
      expect((await readHealth(scope, custom)).data.summary.total_devices).toBe(1);
      expect(await redis.exists(...keys)).toBe(3);

      await invalidateHealthCache(scope.orgId);
      expect(await redis.exists(...keys)).toBe(0);
      expect((await readHealth(scope, normal)).data.summary.total_devices).toBe(1);
    } finally {
      try {
        if (redis.status === 'ready') await redis.del(...keys, ...keys.map(key => `${key}::epoch`));
      } finally {
        await closeRedisConnection();
        env.restore();
      }
    }
  }
);
