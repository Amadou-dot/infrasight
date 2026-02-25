/**
 * Rate Limit Configuration Tests
 *
 * Tests for rate limit config lookup, environment variable parsing,
 * exemption checks, and custom config creation.
 */

// We need to test getEnvNumber via RATE_LIMIT_CONFIGS, so we re-import
// after setting env vars in some tests. Use isolateModules for that.

describe('Rate Limit Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isRateLimitEnabled', () => {
    it('returns true by default (no env var set)', () => {
      delete process.env.RATE_LIMIT_ENABLED;
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      expect(isRateLimitEnabled()).toBe(true);
    });

    it('returns true when RATE_LIMIT_ENABLED is "true"', () => {
      process.env.RATE_LIMIT_ENABLED = 'true';
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      expect(isRateLimitEnabled()).toBe(true);
    });

    it('returns false when RATE_LIMIT_ENABLED is "false"', () => {
      process.env.RATE_LIMIT_ENABLED = 'false';
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      expect(isRateLimitEnabled()).toBe(false);
    });

    it('returns true for arbitrary string (not "false")', () => {
      process.env.RATE_LIMIT_ENABLED = 'yes';
      const { isRateLimitEnabled } = require('@/lib/ratelimit/config');
      expect(isRateLimitEnabled()).toBe(true);
    });
  });

  describe('isRateLimitExempt', () => {
    it('returns true for /api/health', () => {
      const { isRateLimitExempt } = require('@/lib/ratelimit/config');
      expect(isRateLimitExempt('/api/health')).toBe(true);
    });

    it('returns true for /api/v2/metrics', () => {
      const { isRateLimitExempt } = require('@/lib/ratelimit/config');
      expect(isRateLimitExempt('/api/v2/metrics')).toBe(true);
    });

    it('returns true for /api/v2/health', () => {
      const { isRateLimitExempt } = require('@/lib/ratelimit/config');
      expect(isRateLimitExempt('/api/v2/health')).toBe(true);
    });

    it('returns true for subpaths of exempt paths', () => {
      const { isRateLimitExempt } = require('@/lib/ratelimit/config');
      expect(isRateLimitExempt('/api/health/check')).toBe(true);
    });

    it('returns false for non-exempt paths', () => {
      const { isRateLimitExempt } = require('@/lib/ratelimit/config');
      expect(isRateLimitExempt('/api/v2/devices')).toBe(false);
    });

    it('returns true for paths that start with exempt prefix (startsWith behavior)', () => {
      const { isRateLimitExempt } = require('@/lib/ratelimit/config');
      // /api/v2/healthz starts with /api/v2/health, so it is exempt
      expect(isRateLimitExempt('/api/v2/healthz')).toBe(true);
    });

    it('returns false for completely unrelated paths', () => {
      const { isRateLimitExempt } = require('@/lib/ratelimit/config');
      expect(isRateLimitExempt('/api/v2/readings')).toBe(false);
    });
  });

  describe('getRateLimitConfig', () => {
    it('returns null when rate limiting is disabled', () => {
      process.env.RATE_LIMIT_ENABLED = 'false';
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      expect(getRateLimitConfig('/api/v2/devices', 'POST')).toBeNull();
    });

    it('returns null for exempt paths', () => {
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      expect(getRateLimitConfig('/api/health', 'GET')).toBeNull();
    });

    it('returns exact config for /api/v2/readings/ingest', () => {
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      const config = getRateLimitConfig('/api/v2/readings/ingest', 'POST');
      expect(config).not.toBeNull();
      expect(config.perDevice).toBeDefined();
      expect(config.perDevice.name).toBe('ingest:device');
      expect(config.perIp.name).toBe('ingest:ip');
    });

    it('returns MUTATION_DEFAULT for POST requests', () => {
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      const config = getRateLimitConfig('/api/v2/devices', 'POST');
      expect(config).not.toBeNull();
      expect(config.perIp.name).toBe('mutation:ip');
    });

    it('returns MUTATION_DEFAULT for PATCH requests', () => {
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      const config = getRateLimitConfig('/api/v2/devices/123', 'PATCH');
      expect(config.perIp.name).toBe('mutation:ip');
    });

    it('returns MUTATION_DEFAULT for PUT requests', () => {
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      const config = getRateLimitConfig('/api/v2/devices/123', 'PUT');
      expect(config.perIp.name).toBe('mutation:ip');
    });

    it('returns MUTATION_DEFAULT for DELETE requests', () => {
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      const config = getRateLimitConfig('/api/v2/devices/123', 'DELETE');
      expect(config.perIp.name).toBe('mutation:ip');
    });

    it('returns READ_DEFAULT for GET requests', () => {
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      const config = getRateLimitConfig('/api/v2/devices', 'GET');
      expect(config).not.toBeNull();
      expect(config.perIp.name).toBe('read:ip');
    });

    it('handles lowercase method names', () => {
      const { getRateLimitConfig } = require('@/lib/ratelimit/config');
      const config = getRateLimitConfig('/api/v2/devices', 'post');
      expect(config.perIp.name).toBe('mutation:ip');
    });
  });

  describe('RATE_LIMIT_CONFIGS with environment variables', () => {
    it('uses default values when env vars are not set', () => {
      const { RATE_LIMIT_CONFIGS } = require('@/lib/ratelimit/config');
      const ingestConfig = RATE_LIMIT_CONFIGS['/api/v2/readings/ingest'];
      expect(ingestConfig.perDevice.max).toBe(1000);
      expect(ingestConfig.perIp.max).toBe(10000);
    });

    it('uses env var values when set', () => {
      process.env.RATE_LIMIT_INGEST_PER_DEVICE = '500';
      process.env.RATE_LIMIT_INGEST_PER_IP = '5000';
      process.env.RATE_LIMIT_MUTATIONS_PER_IP = '50';
      jest.resetModules();
      const { RATE_LIMIT_CONFIGS } = require('@/lib/ratelimit/config');
      const ingestConfig = RATE_LIMIT_CONFIGS['/api/v2/readings/ingest'];
      expect(ingestConfig.perDevice.max).toBe(500);
      expect(ingestConfig.perIp.max).toBe(5000);
      expect(RATE_LIMIT_CONFIGS['MUTATION_DEFAULT'].perIp.max).toBe(50);
    });

    it('falls back to defaults for non-numeric env vars', () => {
      process.env.RATE_LIMIT_INGEST_PER_DEVICE = 'not-a-number';
      jest.resetModules();
      const { RATE_LIMIT_CONFIGS } = require('@/lib/ratelimit/config');
      expect(RATE_LIMIT_CONFIGS['/api/v2/readings/ingest'].perDevice.max).toBe(1000);
    });

    it('READ_DEFAULT has fixed max of 1000', () => {
      const { RATE_LIMIT_CONFIGS } = require('@/lib/ratelimit/config');
      expect(RATE_LIMIT_CONFIGS['READ_DEFAULT'].perIp.max).toBe(1000);
      expect(RATE_LIMIT_CONFIGS['READ_DEFAULT'].perIp.windowSeconds).toBe(60);
    });
  });

  describe('createRateLimitConfig', () => {
    it('creates a config object', () => {
      const { createRateLimitConfig } = require('@/lib/ratelimit/config');
      const config = createRateLimitConfig('custom:ip', 200, 120);
      expect(config).toEqual({
        name: 'custom:ip',
        max: 200,
        windowSeconds: 120,
      });
    });
  });
});
