/**
 * Index Exports Tests
 *
 * Tests to verify index re-exports work correctly and to boost function coverage
 * by exercising functions through the index files.
 */

// ==========================================================================
// CACHE INDEX EXPORTS
// ==========================================================================

describe('Cache Index Exports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should export all cache functions', () => {
    const cacheExports = require('@/lib/cache');

    // Cache operations
    expect(typeof cacheExports.get).toBe('function');
    expect(typeof cacheExports.set).toBe('function');
    expect(typeof cacheExports.del).toBe('function');
    expect(typeof cacheExports.delPattern).toBe('function');
    expect(typeof cacheExports.getOrSet).toBe('function');
    expect(typeof cacheExports.exists).toBe('function');
    expect(typeof cacheExports.ttl).toBe('function');
    expect(typeof cacheExports.mset).toBe('function');
    expect(typeof cacheExports.isCacheEnabled).toBe('function');

    // TTL constant
    expect(cacheExports.CACHE_TTL).toBeDefined();
  });

  it('should export all cache key functions', () => {
    const cacheExports = require('@/lib/cache');

    // Key generators
    expect(typeof cacheExports.deviceKey).toBe('function');
    expect(typeof cacheExports.devicesListKey).toBe('function');
    expect(typeof cacheExports.metadataKey).toBe('function');
    expect(typeof cacheExports.healthKey).toBe('function');
    expect(typeof cacheExports.latestReadingsKey).toBe('function');
    expect(typeof cacheExports.analyticsKey).toBe('function');

    // Pattern generators
    expect(typeof cacheExports.devicePattern).toBe('function');
    expect(typeof cacheExports.devicesListPattern).toBe('function');
    expect(typeof cacheExports.metadataPattern).toBe('function');
    expect(typeof cacheExports.healthPattern).toBe('function');
    expect(typeof cacheExports.readingsPattern).toBe('function');
    expect(typeof cacheExports.analyticsPattern).toBe('function');

    // Prefixes
    expect(cacheExports.CACHE_PREFIXES).toBeDefined();
  });

  it('should export all invalidation functions', () => {
    const cacheExports = require('@/lib/cache');

    expect(typeof cacheExports.invalidateDevice).toBe('function');
    expect(typeof cacheExports.invalidateAllDevices).toBe('function');
    expect(typeof cacheExports.invalidateOnDeviceCreate).toBe('function');
    expect(typeof cacheExports.invalidateReadings).toBe('function');
    expect(typeof cacheExports.invalidateDeviceReadings).toBe('function');
    expect(typeof cacheExports.invalidateHealthCache).toBe('function');
    expect(typeof cacheExports.invalidateMetadata).toBe('function');
    expect(typeof cacheExports.clearAllCaches).toBe('function');
  });

  it('should generate cache keys correctly via index exports', () => {
    const {
      deviceKey,
      devicesListKey,
      metadataKey,
      healthKey,
      latestReadingsKey,
      analyticsKey,
    } = require('@/lib/cache');

    const orgId = 'test_org';
    expect(deviceKey(orgId, 'test_001')).toBe(`org:${orgId}:device:test_001`);
    expect(devicesListKey(orgId)).toBe(`org:${orgId}:devices:list:default`);
    expect(metadataKey(orgId)).toBe(`org:${orgId}:metadata:default`);
    expect(healthKey(orgId)).toBe(`org:${orgId}:health:default`);
    expect(latestReadingsKey(orgId)).toBe(`org:${orgId}:readings:latest:devices:all:types:all`);
    expect(analyticsKey(orgId, 'test')).toBe(`org:${orgId}:analytics:test:default`);
  });

  it('should generate patterns correctly via index exports', () => {
    const {
      devicePattern,
      devicesListPattern,
      metadataPattern,
      healthPattern,
      readingsPattern,
      analyticsPattern,
    } = require('@/lib/cache');

    const orgId = 'test_org';
    expect(devicePattern(orgId)).toBe(`org:${orgId}:device:*`);
    expect(devicesListPattern(orgId)).toBe(`org:${orgId}:devices:list:*`);
    expect(metadataPattern(orgId)).toBe(`org:${orgId}:metadata:*`);
    expect(healthPattern(orgId)).toBe(`org:${orgId}:health:*`);
    expect(readingsPattern(orgId)).toBe(`org:${orgId}:readings:latest:*`);
    expect(analyticsPattern(orgId)).toBe(`org:${orgId}:analytics:*`);
  });
});

// ==========================================================================
// MONITORING INDEX EXPORTS
// ==========================================================================

describe('Monitoring Index Exports', () => {
  it('should export logger', () => {
    const monitoringExports = require('@/lib/monitoring');

    expect(monitoringExports.logger).toBeDefined();
    expect(typeof monitoringExports.logger.info).toBe('function');
    expect(typeof monitoringExports.logger.warn).toBe('function');
    expect(typeof monitoringExports.logger.error).toBe('function');
    expect(typeof monitoringExports.logger.debug).toBe('function');
  });

  it('should export all metrics functions', () => {
    const monitoringExports = require('@/lib/monitoring');

    expect(typeof monitoringExports.recordRequest).toBe('function');
    expect(typeof monitoringExports.recordError).toBe('function');
    expect(typeof monitoringExports.recordRateLimitHit).toBe('function');
    expect(typeof monitoringExports.recordCacheEvent).toBe('function');
    expect(typeof monitoringExports.recordIngestion).toBe('function');
    expect(typeof monitoringExports.recordDatabaseQuery).toBe('function');
    expect(typeof monitoringExports.getMetricsSnapshot).toBe('function');
    expect(typeof monitoringExports.getPrometheusMetrics).toBe('function');
    expect(typeof monitoringExports.resetMetrics).toBe('function');
  });

  it('should export all tracing functions', () => {
    const monitoringExports = require('@/lib/monitoring');

    expect(typeof monitoringExports.generateTraceId).toBe('function');
    expect(typeof monitoringExports.getTraceId).toBe('function');
    expect(typeof monitoringExports.addTraceHeaders).toBe('function');
    expect(typeof monitoringExports.createRequestTimer).toBe('function');
    expect(typeof monitoringExports.withTracing).toBe('function');
    expect(typeof monitoringExports.createRequestContext).toBe('function');
  });

  it('should export all sentry functions', () => {
    const monitoringExports = require('@/lib/monitoring');

    expect(typeof monitoringExports.isSentryConfigured).toBe('function');
    expect(typeof monitoringExports.initSentry).toBe('function');
    expect(typeof monitoringExports.captureException).toBe('function');
    expect(typeof monitoringExports.captureMessage).toBe('function');
    expect(typeof monitoringExports.addBreadcrumb).toBe('function');
    expect(typeof monitoringExports.setUser).toBe('function');
    expect(typeof monitoringExports.setTag).toBe('function');
    expect(typeof monitoringExports.setExtra).toBe('function');
    expect(typeof monitoringExports.startTransaction).toBe('function');
    expect(typeof monitoringExports.withSentryErrorHandling).toBe('function');
  });

  it('should use tracing functions via index exports', () => {
    const { generateTraceId, createRequestTimer } = require('@/lib/monitoring');

    const traceId = generateTraceId();
    expect(traceId).toMatch(/^[a-f0-9-]+$/);

    const timer = createRequestTimer();
    expect(typeof timer.elapsed).toBe('function');
    expect(typeof timer.elapsed()).toBe('number');
  });
});

// ==========================================================================
// RATELIMIT INDEX EXPORTS
// ==========================================================================

describe('Ratelimit Index Exports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should export all limiter functions', () => {
    const ratelimitExports = require('@/lib/ratelimit');

    expect(typeof ratelimitExports.checkRateLimit).toBe('function');
    expect(typeof ratelimitExports.checkMultipleRateLimits).toBe('function');
    expect(typeof ratelimitExports.resetRateLimit).toBe('function');
    expect(typeof ratelimitExports.getRateLimitStatus).toBe('function');
  });

  it('should export all config functions', () => {
    const ratelimitExports = require('@/lib/ratelimit');

    expect(ratelimitExports.RATE_LIMIT_CONFIGS).toBeDefined();
    expect(typeof ratelimitExports.isRateLimitEnabled).toBe('function');
    expect(typeof ratelimitExports.isRateLimitExempt).toBe('function');
    expect(typeof ratelimitExports.getRateLimitConfig).toBe('function');
    expect(typeof ratelimitExports.createRateLimitConfig).toBe('function');
  });

  it('should export all middleware functions', () => {
    const ratelimitExports = require('@/lib/ratelimit');

    expect(typeof ratelimitExports.withRateLimit).toBe('function');
    expect(typeof ratelimitExports.createRateLimitMiddleware).toBe('function');
    expect(typeof ratelimitExports.getClientIp).toBe('function');
    expect(typeof ratelimitExports.addRateLimitHeaders).toBe('function');
  });

  it('should use config functions via index exports', () => {
    const {
      isRateLimitEnabled,
      isRateLimitExempt,
      createRateLimitConfig,
    } = require('@/lib/ratelimit');

    expect(typeof isRateLimitEnabled()).toBe('boolean');
    expect(typeof isRateLimitExempt('/api/v2/health')).toBe('boolean');

    const config = createRateLimitConfig('test', 10, 60);
    expect(config.name).toBe('test');
    expect(config.max).toBe(10);
  });
});

// ==========================================================================
// MIDDLEWARE INDEX EXPORTS
// ==========================================================================

describe('Middleware Index Exports', () => {
  it('should export all middleware functions', () => {
    const middlewareExports = require('@/lib/middleware');

    // Body size
    expect(typeof middlewareExports.validateBodySize).toBe('function');
    expect(typeof middlewareExports.getMaxBodySize).toBe('function');
    expect(middlewareExports.DEFAULT_BODY_SIZE_CONFIG).toBeDefined();

    // Headers
    expect(typeof middlewareExports.validateHeaders).toBe('function');
    expect(typeof middlewareExports.extractRequestMetadata).toBe('function');

    // Request validation
    expect(typeof middlewareExports.validateRequest).toBe('function');
    expect(typeof middlewareExports.withRequestValidation).toBe('function');
    expect(middlewareExports.ValidationPresets).toBeDefined();
  });
});

// ==========================================================================
// ERRORS INDEX EXPORTS
// ==========================================================================

describe('Errors Index Exports', () => {
  it('should export ApiError class', () => {
    const errorsExports = require('@/lib/errors');

    expect(errorsExports.ApiError).toBeDefined();
    expect(typeof errorsExports.ApiError).toBe('function');

    const error = new errorsExports.ApiError('TEST_CODE', 400, 'Test message');
    expect(error.errorCode).toBe('TEST_CODE');
    expect(error.statusCode).toBe(400);
  });

  it('should export error codes', () => {
    const errorsExports = require('@/lib/errors');

    expect(errorsExports.ErrorCodes).toBeDefined();
    expect(errorsExports.ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
    expect(errorsExports.ErrorCodes.BAD_REQUEST).toBe('BAD_REQUEST');
    expect(errorsExports.ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
  });

  it('should export error code utilities', () => {
    const errorsExports = require('@/lib/errors');

    expect(typeof errorsExports.getStatusCodeForError).toBe('function');
    expect(typeof errorsExports.getErrorDescription).toBe('function');
    expect(typeof errorsExports.isValidErrorCode).toBe('function');
    expect(typeof errorsExports.getErrorCodesForStatus).toBe('function');
    expect(errorsExports.ErrorCodeRegistry).toBeDefined();
  });

  it('should export error handler utilities', () => {
    const errorsExports = require('@/lib/errors');

    expect(typeof errorsExports.withErrorHandler).toBe('function');
    expect(typeof errorsExports.handleError).toBe('function');
    expect(typeof errorsExports.normalizeError).toBe('function');
    expect(typeof errorsExports.errorToResponse).toBe('function');
  });

  it('should use error code utilities via index exports', () => {
    const {
      getStatusCodeForError,
      getErrorDescription,
      isValidErrorCode,
      ErrorCodes,
    } = require('@/lib/errors');

    expect(getStatusCodeForError(ErrorCodes.NOT_FOUND)).toBe(404);
    expect(getErrorDescription(ErrorCodes.NOT_FOUND)).toContain('not found');
    expect(isValidErrorCode('NOT_FOUND')).toBe(true);
    expect(isValidErrorCode('INVALID_CODE')).toBe(false);
  });
});
