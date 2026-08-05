/**
 * Cache Manager Tests
 *
 * Tests for Redis-backed caching functionality.
 * Uses mocked Redis client for isolation.
 */

import {
  get,
  set,
  del,
  delPattern,
  getOrSet,
  exists,
  ttl,
  mset,
  isCacheEnabled,
  CACHE_TTL,
} from '@/lib/cache/cache';
import type * as CacheModule from '@/lib/cache/cache';
import * as redisModule from '@/lib/redis/client';
import { resetMetrics } from '@/lib/monitoring/metrics';

// Mock the Redis client module
jest.mock('@/lib/redis/client', () => ({
  getRedisClient: jest.fn(),
  isRedisAvailable: jest.fn(),
}));

// Mock logger to suppress output during tests
jest.mock('@/lib/monitoring/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    cache: jest.fn(),
  },
}));

// ============================================================================
// A TINY LUA EVALUATOR FOR THE COMMIT SCRIPT
// ============================================================================
//
// WHY THIS EXISTS. The cross-process guard is a Lua script (`lib/cache/cache.ts`,
// COMMIT_IF_EPOCH_UNCHANGED) and CI runs no Redis, so nothing in the committed
// suite used to EXECUTE it — the fake `eval` below reimplemented the
// compare-and-set contract in JavaScript and threw the `_script` argument away.
// That made every assertion about the guard an assertion about the fake. The
// script's `~=` could be flipped to `==`, inverting the guard into "commit only
// when the epoch HAS changed" — committing precisely the stale writes the guard
// exists to prevent — and the whole suite stayed green.
//
// So the fake now runs the real script text. This is not a Lua implementation;
// it is an interpreter for exactly the constructs COMMIT_IF_EPOCH_UNCHANGED
// uses (local binding, `redis.call`, one-line `if ... then ... end`, `return
// <int>`, `==`/`~=` on strings and booleans). Anything else throws rather than
// being skipped or guessed at, so a future edit that outgrows it fails loudly
// here instead of quietly reverting these tests to testing a fake again.
//
// Semantics that matter and are deliberately modelled:
//   - a missing key makes `redis.call('GET', ...)` yield `false`, because Redis
//     maps nil to false in Lua. That is what the script's `current == false`
//     normalization exists to handle.
//   - `==` does not coerce across types, so `'' == false` is false, as in Lua.

/** The only value types this script ever produces. */
type LuaValue = string | boolean | number;

interface LuaRedis {
  call(command: string, ...args: LuaValue[]): LuaValue;
}

function unsupportedLua(what: string, detail: string): never {
  throw new Error(
    `The commit script uses Lua this evaluator does not implement (${what}): ${detail}`
  );
}

/** Splits a call's argument list on top-level commas. */
function splitLuaArgs(argList: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of argList) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) args.push(current);

  return args;
}

/**
 * Execute `script` with the given KEYS/ARGV against `redis`, returning the
 * integer the script returns. Lua is 1-indexed; KEYS/ARGV are passed 0-indexed
 * here and adjusted on lookup.
 */
function runLuaCommitScript(
  script: string,
  keys: string[],
  argv: string[],
  redis: LuaRedis
): number {
  const locals = new Map<string, LuaValue>();

  const evaluate = (raw: string): LuaValue => {
    const expression = raw.trim();

    const argvIndex = /^ARGV\[(\d+)\]$/.exec(expression);
    if (argvIndex) return argv[Number(argvIndex[1]) - 1] ?? false;

    const keysIndex = /^KEYS\[(\d+)\]$/.exec(expression);
    if (keysIndex) return keys[Number(keysIndex[1]) - 1] ?? false;

    const stringLiteral = /^'([^']*)'$/.exec(expression);
    if (stringLiteral) return stringLiteral[1];

    if (expression === 'false') return false;
    if (expression === 'true') return true;
    if (/^-?\d+$/.test(expression)) return Number(expression);

    const call = /^redis\.call\((.*)\)$/.exec(expression);
    if (call) {
      const [command, ...args] = splitLuaArgs(call[1]).map(evaluate);
      if (typeof command !== 'string') unsupportedLua('redis.call command', expression);
      return redis.call(command, ...args);
    }

    if (/^[A-Za-z_]\w*$/.test(expression)) {
      if (!locals.has(expression)) unsupportedLua('unbound name', expression);
      return locals.get(expression) as LuaValue;
    }

    return unsupportedLua('expression', expression);
  };

  const isTruthy = (raw: string): boolean => {
    const comparison = /^(.+?)\s*(==|~=)\s*(.+)$/.exec(raw.trim());
    if (!comparison) unsupportedLua('condition', raw);

    // No cross-type coercion, exactly like Lua: '' does not equal false.
    const equal = evaluate(comparison[1]) === evaluate(comparison[3]);
    return comparison[2] === '==' ? equal : !equal;
  };

  /** Returns the script's return value, or undefined if the statement fell through. */
  const execute = (raw: string): number | undefined => {
    const statement = raw.trim();

    const returned = /^return\s+(-?\d+)$/.exec(statement);
    if (returned) return Number(returned[1]);

    const declaration = /^local\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(statement);
    if (declaration) {
      locals.set(declaration[1], evaluate(declaration[2]));
      return undefined;
    }

    if (/^redis\.call\(/.test(statement)) {
      evaluate(statement);
      return undefined;
    }

    const assignment = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(statement);
    if (assignment) {
      if (!locals.has(assignment[1]))
        unsupportedLua('assignment to an undeclared name', statement);
      locals.set(assignment[1], evaluate(assignment[2]));
      return undefined;
    }

    return unsupportedLua('statement', statement);
  };

  const lines = script
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('--'));

  for (const line of lines) {
    const conditional = /^if\s+(.+?)\s+then\s+(.+?)\s+end$/.exec(line);

    if (conditional) {
      if (!isTruthy(conditional[1])) continue;
      const result = execute(conditional[2]);
      if (result !== undefined) return result;
      continue;
    }

    const result = execute(line);
    if (result !== undefined) return result;
  }

  return unsupportedLua('control flow', 'the script ended without returning');
}

/** A `redis` table backed by a plain key/value map, for the evaluator to call into. */
function createLuaRedis(store: Map<string, string>): LuaRedis {
  return {
    call(command: string, ...args: LuaValue[]): LuaValue {
      const name = command.toUpperCase();

      if (name === 'GET') {
        const key = String(args[0]);
        // Redis maps a missing key's nil to `false` in Lua.
        return store.has(key) ? (store.get(key) as string) : false;
      }

      if (name === 'SETEX') {
        const [key, , value] = args.map(String);
        store.set(key, value);
        return 'OK';
      }

      return unsupportedLua('redis command', name);
    },
  };
}

/** ioredis' `eval(script, numKeys, ...keysThenArgv)` calling convention. */
function evalWithLua(store: Map<string, string>) {
  return async (script: string, numKeys: number, ...args: string[]): Promise<number> =>
    runLuaCommitScript(script, args.slice(0, numKeys), args.slice(numKeys), createLuaRedis(store));
}

describe('Cache Manager', () => {
  // Save original env and reset mocks before each test
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ==========================================================================
  // CACHE CONFIGURATION
  // ==========================================================================

  describe('CACHE_TTL', () => {
    it('should define TTL values for all cache types', () => {
      expect(CACHE_TTL.METADATA).toBeDefined();
      expect(CACHE_TTL.HEALTH).toBeDefined();
      expect(CACHE_TTL.DEVICE).toBeDefined();
      expect(CACHE_TTL.READINGS_LATEST).toBeDefined();
      expect(CACHE_TTL.ANALYTICS).toBeDefined();
      expect(CACHE_TTL.DEVICES_LIST).toBeDefined();
    });

    it('should use environment variables when available', () => {
      // Note: CACHE_TTL is set at module load time, so we just verify current values
      expect(typeof CACHE_TTL.METADATA).toBe('number');
      expect(typeof CACHE_TTL.HEALTH).toBe('number');
    });
  });

  describe('isCacheEnabled()', () => {
    it('should return true by default', () => {
      delete process.env.CACHE_ENABLED;
      expect(isCacheEnabled()).toBe(true);
    });

    it('should return false when CACHE_ENABLED is "false"', () => {
      process.env.CACHE_ENABLED = 'false';
      expect(isCacheEnabled()).toBe(false);
    });

    it('should return true for any other value', () => {
      process.env.CACHE_ENABLED = 'true';
      expect(isCacheEnabled()).toBe(true);

      process.env.CACHE_ENABLED = '1';
      expect(isCacheEnabled()).toBe(true);
    });
  });

  // ==========================================================================
  // GET OPERATION
  // ==========================================================================

  describe('get()', () => {
    it('should return null when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await get<string>('test-key');

      expect(result).toBeNull();
    });

    it('should return null when Redis client is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await get<string>('test-key');

      expect(result).toBeNull();
    });

    it('should return null when Redis is not connected', async () => {
      const mockRedis = { get: jest.fn() };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(false);

      const result = await get<string>('test-key');

      expect(result).toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should return cached value when found', async () => {
      const mockData = { id: 'device_001', name: 'Test Device' };
      const mockRedis = { get: jest.fn().mockResolvedValue(JSON.stringify(mockData)) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await get<typeof mockData>('device:device_001');

      expect(result).toEqual(mockData);
      expect(mockRedis.get).toHaveBeenCalledWith('device:device_001');
    });

    it('should return null when key not found in cache', async () => {
      const mockRedis = { get: jest.fn().mockResolvedValue(null) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await get<string>('nonexistent-key');

      expect(result).toBeNull();
    });

    it('should return null and log warning on Redis error', async () => {
      const mockRedis = { get: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await get<string>('test-key');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // SET OPERATION
  // ==========================================================================

  describe('set()', () => {
    it('should return false when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await set('test-key', { data: 'test' }, { ttl: 60 });

      expect(result).toBe(false);
    });

    it('should return false when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await set('test-key', { data: 'test' }, { ttl: 60 });

      expect(result).toBe(false);
    });

    it('should set value with TTL successfully', async () => {
      const mockRedis = { setex: jest.fn().mockResolvedValue('OK') };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const data = { id: 'device_001', status: 'active' };
      const result = await set('device:device_001', data, { ttl: 300 });

      expect(result).toBe(true);
      expect(mockRedis.setex).toHaveBeenCalledWith('device:device_001', 300, JSON.stringify(data));
    });

    it('should return false on Redis error', async () => {
      const mockRedis = { setex: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await set('test-key', { data: 'test' }, { ttl: 60 });

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // DELETE OPERATION
  // ==========================================================================

  describe('del()', () => {
    it('should return 0 when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await del('test-key');

      expect(result).toBe(0);
    });

    it('should return 0 when no keys provided', async () => {
      const result = await del();

      expect(result).toBe(0);
    });

    it('should return 0 when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await del('test-key');

      expect(result).toBe(0);
    });

    it('should delete single key successfully', async () => {
      const mockRedis = { del: jest.fn().mockResolvedValue(1) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await del('device:device_001');

      expect(result).toBe(1);
      expect(mockRedis.del).toHaveBeenCalledWith('device:device_001');
    });

    // The cross-process half of the stale-write guard: an invalidation has to
    // leave a mark another process can see, which is the per-key epoch.
    it('should bump the key epoch before deleting', async () => {
      const pipeline = {
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      const mockRedis = {
        pipeline: jest.fn().mockReturnValue(pipeline),
        del: jest.fn().mockResolvedValue(1),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await del('device:device_001');

      expect(result).toBe(1);
      expect(pipeline.incr).toHaveBeenCalledWith('device:device_001::epoch');
      expect(pipeline.expire).toHaveBeenCalledWith('device:device_001::epoch', 3600);
      // The epoch must be bumped BEFORE the DEL, so a getOrSet in another
      // process that reads it from that moment on already sees the new value.
      expect(pipeline.exec.mock.invocationCallOrder[0]).toBeLessThan(
        mockRedis.del.mock.invocationCallOrder[0]
      );
    });

    // Invalidation has always been best effort here (`del` already returns 0
    // and warns on a Redis fault). A failed epoch bump must degrade the same
    // way rather than stopping the DEL, which is the stronger of the two
    // signals — and layer 1 still covers the instance.
    it('should still delete when the epoch bump fails', async () => {
      const mockRedis = {
        pipeline: jest.fn(() => {
          throw new Error('pipeline unavailable');
        }),
        del: jest.fn().mockResolvedValue(1),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await del('device:device_001');

      expect(result).toBe(1);
      expect(mockRedis.del).toHaveBeenCalledWith('device:device_001');
    });

    it('should delete multiple keys successfully', async () => {
      const mockRedis = { del: jest.fn().mockResolvedValue(3) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await del('key1', 'key2', 'key3');

      expect(result).toBe(3);
      expect(mockRedis.del).toHaveBeenCalledWith('key1', 'key2', 'key3');
    });

    it('should return 0 on Redis error', async () => {
      const mockRedis = { del: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await del('test-key');

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // DELETE PATTERN OPERATION
  // ==========================================================================

  describe('delPattern()', () => {
    it('should return 0 when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await delPattern('device:*');

      expect(result).toBe(0);
    });

    it('should return 0 when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await delPattern('device:*');

      expect(result).toBe(0);
    });

    it('should scan and delete matching keys', async () => {
      const mockRedis = {
        scan: jest.fn().mockResolvedValueOnce(['0', ['device:001', 'device:002']]),
        del: jest.fn().mockResolvedValue(2),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await delPattern('device:*');

      expect(result).toBe(2);
      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'device:*', 'COUNT', 100);
    });

    // Cross-process cover for the keys a pattern actually matched. It is
    // strictly weaker than an exact-key del: a key ABSENT at scan time cannot
    // be enumerated, and that is the very key a racing getOrSet missed on —
    // only layer 1 covers that, and only within the instance.
    it('should bump the epoch of every key the scan matched', async () => {
      const pipeline = {
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      const mockRedis = {
        scan: jest.fn().mockResolvedValueOnce(['0', ['device:001', 'device:002']]),
        pipeline: jest.fn().mockReturnValue(pipeline),
        del: jest.fn().mockResolvedValue(2),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      await delPattern('device:*');

      expect(pipeline.incr).toHaveBeenCalledWith('device:001::epoch');
      expect(pipeline.incr).toHaveBeenCalledWith('device:002::epoch');
    });

    it('should handle multiple scan iterations', async () => {
      const mockRedis = {
        scan: jest
          .fn()
          .mockResolvedValueOnce(['123', ['key1', 'key2']])
          .mockResolvedValueOnce(['0', ['key3']]),
        del: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await delPattern('test:*');

      expect(result).toBe(3);
      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
    });

    it('should handle empty scan result', async () => {
      const mockRedis = {
        scan: jest.fn().mockResolvedValue(['0', []]),
        del: jest.fn(),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await delPattern('nonexistent:*');

      expect(result).toBe(0);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should return 0 on Redis error', async () => {
      const mockRedis = {
        scan: jest.fn().mockRejectedValue(new Error('Redis error')),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await delPattern('device:*');

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // GET OR SET (CACHE-ASIDE) OPERATION
  // ==========================================================================

  describe('getOrSet()', () => {
    it('should return cached value if available', async () => {
      const cachedData = { id: 'device_001', name: 'Cached Device' };
      const mockRedis = { get: jest.fn().mockResolvedValue(JSON.stringify(cachedData)) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const fetchFn = jest.fn();
      const result = await getOrSet('device:device_001', fetchFn, { ttl: 300 });

      expect(result).toEqual(cachedData);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    // The write now commits through a Lua compare-and-set rather than a bare
    // SETEX, so that an invalidation from ANOTHER process — which this
    // process's in-memory generation counter cannot see — still cancels it.
    // The SETEX happens inside the script, server-side.
    it('should fetch and cache when cache miss', async () => {
      const freshData = { id: 'device_001', name: 'Fresh Device' };
      const mockRedis = {
        get: jest.fn().mockResolvedValue(null),
        eval: jest.fn().mockResolvedValue(1),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const fetchFn = jest.fn().mockResolvedValue(freshData);
      const result = await getOrSet('device:device_001', fetchFn, { ttl: 300 });

      expect(result).toEqual(freshData);
      expect(fetchFn).toHaveBeenCalled();
      // the commit is called asynchronously, wait a tick
      await new Promise(resolve => setImmediate(resolve));
      expect(mockRedis.eval).toHaveBeenCalled();

      // Shape only. What the script must SEMANTICALLY do is asserted in the
      // 'commit script invariants' block below — a `toContain('SETEX')` here
      // survives deletion of the epoch compare and would let the whole
      // cross-process mechanism regress silently.
      const [script, numKeys, valueKey, epochK, ttlArg, payload] = mockRedis.eval.mock.calls[0];
      expect(script).toContain('SETEX');
      expect(numKeys).toBe(2);
      expect(valueKey).toBe('device:device_001');
      expect(epochK).toBe('device:device_001::epoch');
      expect(ttlArg).toBe('300');
      expect(payload).toBe(JSON.stringify(freshData));
    });

    it('should snapshot the key epoch before fetching, not after', async () => {
      const mockRedis = {
        get: jest.fn().mockResolvedValue(null),
        eval: jest.fn().mockResolvedValue(1),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const fetchFn = jest.fn().mockResolvedValue({ id: 'device_001' });
      await getOrSet('device:device_001', fetchFn, { ttl: 300 });

      // An epoch read after the fetch would be blind to exactly the
      // invalidations this guard exists to catch.
      expect(mockRedis.get).toHaveBeenCalledWith('device:device_001::epoch');
      const epochRead = mockRedis.get.mock.invocationCallOrder[1];
      expect(epochRead).toBeLessThan(fetchFn.mock.invocationCallOrder[0]);
    });

    it('should return fetched data even if cache set fails', async () => {
      const freshData = { id: 'device_001' };
      const mockRedis = {
        get: jest.fn().mockResolvedValue(null),
        eval: jest.fn().mockRejectedValue(new Error('Set failed')),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const fetchFn = jest.fn().mockResolvedValue(freshData);
      const result = await getOrSet('device:device_001', fetchFn, { ttl: 300 });

      expect(result).toEqual(freshData);
    });

    // Degradation must match the rest of this module: no cache, no throw. A
    // cache that hard-failed with Redis down would be a worse regression than
    // the race it is guarding against.
    it('should return fetched data when Redis is unavailable', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const freshData = { id: 'device_001' };
      const fetchFn = jest.fn().mockResolvedValue(freshData);

      await expect(getOrSet('device:device_001', fetchFn, { ttl: 300 })).resolves.toEqual(
        freshData
      );
      expect(fetchFn).toHaveBeenCalled();
    });

    // An unreadable epoch is not the same as "never invalidated". It must fail
    // CLOSED — skip the write — or a flapping Redis would reopen the race.
    it('should skip the write when the epoch could not be read', async () => {
      const mockRedis = {
        get: jest
          .fn()
          // the value read: a miss
          .mockResolvedValueOnce(null)
          // the epoch read: a fault
          .mockRejectedValueOnce(new Error('epoch read failed')),
        eval: jest.fn().mockResolvedValue(0),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const freshData = { id: 'device_001' };
      const result = await getOrSet('device:device_001', jest.fn().mockResolvedValue(freshData), {
        ttl: 300,
      });
      await new Promise(resolve => setImmediate(resolve));

      expect(result).toEqual(freshData);
      // The observed epoch handed to the CAS cannot be a value INCR can
      // produce, so the compare can only fail.
      const observed = mockRedis.eval.mock.calls[0][6];
      expect(observed).not.toBe('');
      expect(observed).not.toMatch(/^\d+$/);
    });
  });

  // ==========================================================================
  // COMMIT SCRIPT INVARIANTS
  // ==========================================================================
  //
  // The whole cross-process guard lives inside a Lua script, and no test that
  // runs in CI executes Lua — the fakes elsewhere in this file implement the
  // compare-and-set CONTRACT in JavaScript. Without this block, someone could
  // delete the epoch comparison from the script and every test would stay
  // green while production silently lost the guard.
  //
  // So these assert the script's SEMANTICS structurally, on the exact text the
  // module hands to EVAL (captured from the call, so it cannot drift from what
  // ships). They are deliberately behavioural rather than a whole-string
  // snapshot: each one names a property the script must have, and says why.
  //
  // Executing the real thing is covered separately and opt-in, by
  // `__tests__/integration/cache-commit-script.redis.test.ts`.
  describe('commit script invariants', () => {
    /** The script the module actually passes to EVAL. Ground truth, not file text. */
    async function captureCommitScript(): Promise<string> {
      const mockRedis = {
        get: jest.fn().mockResolvedValue(null),
        eval: jest.fn().mockResolvedValue(1),
      };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      await getOrSet('script:probe', async () => ({ probe: true }), { ttl: 60 });
      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.eval).toHaveBeenCalled();
      return mockRedis.eval.mock.calls[0][0] as string;
    }

    /**
     * Locate each required step by line. The script is straight-line, so line
     * ORDER is what encodes reachability: a `return 0` above the write means
     * the write cannot run on the branch that returns.
     */
    function analyse(script: string) {
      const lines = script
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

      const at = (pattern: RegExp) => lines.findIndex(line => pattern.test(line));

      return {
        lines,
        /** Binds the caller's observed epoch. */
        bindsObserved: at(/=\s*ARGV\[3\]/),
        /** Reads the CURRENT epoch from the epoch key. */
        readsEpoch: at(/redis\.call\(\s*'GET'\s*,\s*KEYS\[2\]\s*\)/),
        /** Normalizes a missing epoch key, so "never invalidated" compares equal to ''. */
        normalizesMissing: at(/==\s*false/),
        /**
         * Compares the two AND bails out. Both halves required on one line.
         *
         * The operator is pinned to `~=` on purpose. An earlier version of
         * this matcher accepted `==` as well, which meant it passed against
         * the exact inversion it was written to catch — "commit only when the
         * epoch HAS changed" — a guard that refuses every legitimate write and
         * admits every stale one. `guards` must mean "bails out on a
         * MISMATCH", so only the inequality qualifies.
         */
        guards: lines.findIndex(
          line =>
            /\bcurrent\b\s*~=\s*\bobserved\b|\bobserved\b\s*~=\s*\bcurrent\b/.test(line) &&
            /\breturn\s+0\b/.test(line)
        ),
        /** The one and only write. */
        writes: at(/redis\.call\(\s*'SETEX'\s*,\s*KEYS\[1\]\s*,\s*ARGV\[1\]\s*,\s*ARGV\[2\]\s*\)/),
        writeCount: lines.filter(line => /redis\.call\(\s*'SETEX'/.test(line)).length,
      };
    }

    it('should read the current epoch and bind the epoch the caller observed', async () => {
      const script = analyse(await captureCommitScript());

      expect(script.readsEpoch).toBeGreaterThanOrEqual(0);
      expect(script.bindsObserved).toBeGreaterThanOrEqual(0);
    });

    it('should treat a missing epoch key as the empty observation', async () => {
      const script = analyse(await captureCommitScript());

      // Without this, the very first write to a never-invalidated key would
      // compare `false` against `''` and be refused forever — the guard would
      // turn into "caching is off".
      expect(script.normalizesMissing).toBeGreaterThanOrEqual(0);
      expect(script.normalizesMissing).toBeGreaterThan(script.readsEpoch);
    });

    // THE assertion this block exists for. Deleting
    // `if current ~= observed then return 0 end` makes `guards` -1 and fails
    // here, which is exactly the regression that must not reach production.
    it('should compare the observed epoch against the current one and return early when they differ', async () => {
      const script = analyse(await captureCommitScript());

      expect(script.guards).toBeGreaterThanOrEqual(0);
      // You cannot compare what you have not read or bound yet.
      expect(script.guards).toBeGreaterThan(script.readsEpoch);
      expect(script.guards).toBeGreaterThan(script.bindsObserved);
    });

    it('should place the write after the guard, so a mismatch cannot reach it', async () => {
      const script = analyse(await captureCommitScript());

      expect(script.writes).toBeGreaterThanOrEqual(0);
      expect(script.guards).toBeGreaterThanOrEqual(0);
      // Straight-line script: the guard returns, so every line below it runs
      // only on the matching branch. A write ABOVE the guard would be
      // unconditional and the epoch would be decorative.
      expect(script.writes).toBeGreaterThan(script.guards);
    });

    it('should contain exactly one write, so no path bypasses the guard', async () => {
      const script = analyse(await captureCommitScript());

      expect(script.writeCount).toBe(1);
    });

    it('should signal a refusal distinguishably from a commit', async () => {
      const script = analyse(await captureCommitScript());

      // commitIfEpochUnchanged treats anything other than 1 as "refused", so
      // the script has to actually return both outcomes.
      expect(script.lines.some(line => /\breturn\s+0\b/.test(line))).toBe(true);
      expect(script.lines.some(line => /\breturn\s+1\b/.test(line))).toBe(true);
    });

    // ------------------------------------------------------------------
    // ...and the same script, EXECUTED.
    // ------------------------------------------------------------------
    //
    // The structural rows above describe the script's shape. These run it.
    // Shape assertions can only ever check that some comparison is present;
    // running it is what pins down which way round the comparison points. An
    // inverted guard (`~=` flipped to `==`) satisfies "a comparison exists"
    // and fails every row below.
    describe('executed against the evaluator', () => {
      const VALUE_KEY = 'exec:key';
      const EPOCH_KEY = 'exec:key::epoch';
      const TTL = '60';
      const PAYLOAD = '{"fresh":true}';

      /** Runs the module's real script over a store seeded with `epoch`. */
      async function run(epoch: string | null, observedEpoch: string) {
        const store = new Map<string, string>();
        if (epoch !== null) store.set(EPOCH_KEY, epoch);

        const result = await evalWithLua(store)(
          await captureCommitScript(),
          2,
          VALUE_KEY,
          EPOCH_KEY,
          TTL,
          PAYLOAD,
          observedEpoch
        );

        return { result, store };
      }

      it('should commit when the epoch is unchanged since it was observed', async () => {
        const { result, store } = await run('7', '7');

        expect(result).toBe(1);
        expect(store.get(VALUE_KEY)).toBe(PAYLOAD);
      });

      it('should REFUSE and write nothing when the epoch moved on', async () => {
        // The C6 race itself: the fetch observed epoch 7, an invalidation in
        // another process bumped it to 8, and this write is now stale.
        const { result, store } = await run('8', '7');

        expect(result).toBe(0);
        expect(store.has(VALUE_KEY)).toBe(false);
      });

      it('should commit the first write to a key that was never invalidated', async () => {
        // No epoch key at all: GET yields false, the script normalizes it to
        // '', and '' is what readEpoch reported. Were this refused, caching
        // would simply never happen.
        const { result, store } = await run(null, '');

        expect(result).toBe(1);
        expect(store.get(VALUE_KEY)).toBe(PAYLOAD);
      });

      it('should refuse an unreadable epoch, which can never equal a real one', async () => {
        // EPOCH_UNREADABLE contains a NUL byte precisely so it cannot collide
        // with anything INCR produced. Fail closed.
        const { result, store } = await run('3', '\u0000unreadable');

        expect(result).toBe(0);
        expect(store.has(VALUE_KEY)).toBe(false);
      });
    });
  });

  // ==========================================================================
  // CROSS-PROCESS STALE-WRITE GUARD
  // ==========================================================================
  //
  // The in-process generation counter cannot see across a process boundary,
  // and on serverless the two halves of this race normally land on different
  // function instances: the PATCH that disables an alert rule runs in one, the
  // ingest request that repopulates the rule cache runs in another. So these
  // tests deliberately DEFEAT the in-process layer — two isolated module
  // registries, i.e. two independent generation counters — sharing one fake
  // Redis. Only the Redis-side epoch can pass them.
  //
  // The fake's `eval` EXECUTES the module's real script text through
  // `runLuaCommitScript` (see the evaluator at the top of this file), so these
  // rows pass or fail on what the script actually says, not on a JavaScript
  // restatement of what it is supposed to say. The script was additionally
  // verified against a real Redis 7 out of band; see the round-2 section of
  // the P4 report for the exact command and its output.
  describe('cross-process guard (Redis epoch)', () => {
    /** One shared "Redis server" that several isolated cache modules can talk to. */
    function createSharedRedis() {
      const store = new Map<string, string>();

      const redis = {
        store,
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        setex: jest.fn(async (key: string, _ttl: number, value: string) => {
          store.set(key, value);
          return 'OK';
        }),
        del: jest.fn(async (...keys: string[]) => {
          let deleted = 0;
          for (const key of keys) if (store.delete(key)) deleted += 1;
          return deleted;
        }),
        incr: jest.fn(async (key: string) => {
          const next = Number(store.get(key) ?? '0') + 1;
          store.set(key, String(next));
          return next;
        }),
        expire: jest.fn(async (_key: string, _seconds: number) => 1),
        pipeline: jest.fn(() => {
          const queued: Array<() => Promise<unknown>> = [];
          const chain = {
            incr(key: string) {
              queued.push(() => redis.incr(key));
              return chain;
            },
            expire(key: string, seconds: number) {
              queued.push(() => redis.expire(key, seconds));
              return chain;
            },
            async exec() {
              const results: Array<[null, unknown]> = [];
              for (const op of queued) results.push([null, await op()]);
              return results;
            },
          };
          return chain;
        }),
        // Runs the module's REAL script text through `runLuaCommitScript`
        // rather than reimplementing the compare-and-set. Atomic by
        // construction: the interpreter is synchronous from first line to
        // return, which is the property EVAL gives on a real server.
        eval: jest.fn(evalWithLua(store)),
      };

      return redis;
    }

    /**
     * Load a FRESH copy of the cache module — its own module-level generation
     * counter and invalidation log — bound to the shared Redis. This is what
     * stands in for a separate serverless instance.
     */
    function loadCacheInstance(sharedRedis: unknown): typeof CacheModule {
      let instance!: typeof CacheModule;

      jest.isolateModules(() => {
        const isolatedRedis = require('@/lib/redis/client') as typeof redisModule;
        (isolatedRedis.getRedisClient as jest.Mock).mockReturnValue(sharedRedis);
        (isolatedRedis.isRedisAvailable as jest.Mock).mockReturnValue(true);
        instance = require('@/lib/cache/cache') as typeof CacheModule;
      });

      return instance;
    }

    function deferred() {
      let resolve!: () => void;
      const promise = new Promise<void>(r => {
        resolve = r;
      });
      return { promise, resolve };
    }

    const RULES_KEY = 'alert:rules:active';

    it('should not let one instance resurrect a value another instance invalidated', async () => {
      const shared = createSharedRedis();
      const instanceA = loadCacheInstance(shared);
      const instanceB = loadCacheInstance(shared);

      // Genuinely separate module state, or this test proves nothing.
      expect(instanceA).not.toBe(instanceB);

      const fetchStarted = deferred();
      const release = deferred();

      // A: the value read misses, A snapshots the epoch, A starts fetching the
      // pre-mutation rule set.
      const inFlight = instanceA.getOrSet(
        RULES_KEY,
        async () => {
          fetchStarted.resolve();
          await release.promise;
          return [{ _id: 'rule_1', enabled: true }];
        },
        { ttl: 60 }
      );
      await fetchStarted.promise;

      // B: a different instance disables the rule and invalidates.
      await instanceB.del(RULES_KEY);

      // A completes and tries to publish what it loaded.
      release.resolve();
      const stale = await inFlight;
      expect(stale).toEqual([{ _id: 'rule_1', enabled: true }]);
      await new Promise(resolve => setImmediate(resolve));

      // THE assertion: the stale value never landed. Not "landed and then
      // expired". Stated first so it is what fails if the guard regresses,
      // rather than the corroborating detail below.
      expect(shared.store.has(RULES_KEY)).toBe(false);

      // Corroboration: A's own generation counter never saw B's invalidation,
      // so A really did reach the commit and was refused there. Without this,
      // a test that passed because layer 1 happened to fire would look
      // identical, and the cross-process property would be untested.
      expect(shared.eval).toHaveBeenCalledTimes(1);
      await expect(shared.eval.mock.results[0].value).resolves.toBe(0);
    });

    it('should let an instance commit when no other instance invalidated', async () => {
      const shared = createSharedRedis();
      const instanceA = loadCacheInstance(shared);
      loadCacheInstance(shared);

      const value = await instanceA.getOrSet(RULES_KEY, async () => [{ _id: 'rule_1' }], {
        ttl: 60,
      });
      await new Promise(resolve => setImmediate(resolve));

      expect(value).toEqual([{ _id: 'rule_1' }]);
      expect(shared.store.get(RULES_KEY)).toBe(JSON.stringify([{ _id: 'rule_1' }]));
    });

    it('should keep refusing across repeated invalidations, not just the first', async () => {
      const shared = createSharedRedis();
      const instanceA = loadCacheInstance(shared);
      const instanceB = loadCacheInstance(shared);

      for (let round = 0; round < 3; round += 1) {
        const fetchStarted = deferred();
        const release = deferred();

        const inFlight = instanceA.getOrSet(
          RULES_KEY,
          async () => {
            fetchStarted.resolve();
            await release.promise;
            return [{ round }];
          },
          { ttl: 60 }
        );
        await fetchStarted.promise;
        await instanceB.del(RULES_KEY);
        release.resolve();
        await inFlight;
        await new Promise(resolve => setImmediate(resolve));

        expect(shared.store.has(RULES_KEY)).toBe(false);
      }

      // Three invalidations, three monotonically increasing epochs.
      expect(shared.store.get(`${RULES_KEY}::epoch`)).toBe('3');
    });
  });

  // ==========================================================================
  // EXISTS OPERATION
  // ==========================================================================

  describe('exists()', () => {
    it('should return false when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await exists('test-key');

      expect(result).toBe(false);
    });

    it('should return false when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await exists('test-key');

      expect(result).toBe(false);
    });

    it('should return true when key exists', async () => {
      const mockRedis = { exists: jest.fn().mockResolvedValue(1) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await exists('device:device_001');

      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      const mockRedis = { exists: jest.fn().mockResolvedValue(0) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await exists('nonexistent-key');

      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      const mockRedis = { exists: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await exists('test-key');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // TTL OPERATION
  // ==========================================================================

  describe('ttl()', () => {
    it('should return -2 when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await ttl('test-key');

      expect(result).toBe(-2);
    });

    it('should return -2 when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await ttl('test-key');

      expect(result).toBe(-2);
    });

    it('should return TTL for existing key', async () => {
      const mockRedis = { ttl: jest.fn().mockResolvedValue(250) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await ttl('device:device_001');

      expect(result).toBe(250);
    });

    it('should return -1 for key without TTL', async () => {
      const mockRedis = { ttl: jest.fn().mockResolvedValue(-1) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await ttl('persistent-key');

      expect(result).toBe(-1);
    });

    it('should return -2 for non-existent key', async () => {
      const mockRedis = { ttl: jest.fn().mockResolvedValue(-2) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await ttl('nonexistent-key');

      expect(result).toBe(-2);
    });

    it('should return -2 on Redis error', async () => {
      const mockRedis = { ttl: jest.fn().mockRejectedValue(new Error('Redis error')) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await ttl('test-key');

      expect(result).toBe(-2);
    });
  });

  // ==========================================================================
  // MSET OPERATION
  // ==========================================================================

  describe('mset()', () => {
    it('should return 0 when cache is disabled', async () => {
      process.env.CACHE_ENABLED = 'false';

      const result = await mset([{ key: 'key1', value: 'value1', ttl: 60 }]);

      expect(result).toBe(0);
    });

    it('should return 0 when entries array is empty', async () => {
      const result = await mset([]);

      expect(result).toBe(0);
    });

    it('should return 0 when Redis is not available', async () => {
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(null);

      const result = await mset([{ key: 'key1', value: 'value1', ttl: 60 }]);

      expect(result).toBe(0);
    });

    it('should set multiple values with pipeline', async () => {
      const mockPipeline = {
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([['OK'], ['OK'], ['OK']]),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const entries = [
        { key: 'key1', value: { data: 'value1' }, ttl: 60 },
        { key: 'key2', value: { data: 'value2' }, ttl: 120 },
        { key: 'key3', value: { data: 'value3' }, ttl: 180 },
      ];
      const result = await mset(entries);

      expect(result).toBe(3);
      expect(mockPipeline.setex).toHaveBeenCalledTimes(3);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should return 0 on Redis error', async () => {
      const mockPipeline = {
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Pipeline error')),
      };
      const mockRedis = { pipeline: jest.fn().mockReturnValue(mockPipeline) };
      (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      (redisModule.isRedisAvailable as jest.Mock).mockReturnValue(true);

      const result = await mset([{ key: 'key1', value: 'value1', ttl: 60 }]);

      expect(result).toBe(0);
    });
  });
});
