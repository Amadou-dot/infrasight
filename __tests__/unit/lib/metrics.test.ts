/**
 * Metrics Collection Tests
 *
 * Tests for application metrics tracking and export functions.
 */

import {
  recordRequest,
  recordError,
  recordRateLimitHit,
  recordCacheEvent,
  recordIngestion,
  recordDatabaseQuery,
  getMetricsSnapshot,
  getPrometheusMetrics,
  resetMetrics,
} from '@/lib/monitoring/metrics';

describe('Metrics Collection', () => {
  // Reset metrics before each test to ensure isolation
  beforeEach(() => {
    resetMetrics();
  });

  // ==========================================================================
  // RECORDING FUNCTIONS
  // ==========================================================================

  describe('recordRequest()', () => {
    it('should record request latency and count', () => {
      recordRequest('GET', '/api/v2/devices', 200, 50);

      const snapshot = getMetricsSnapshot();
      const requests = snapshot.requests as Record<string, unknown>;
      const latency = requests.latency as Record<string, unknown>;
      const counts = requests.counts as Record<string, number>;

      expect(latency['GET:/api/v2/devices']).toBeDefined();
      expect(counts['GET:/api/v2/devices:200']).toBe(1);
    });

    it('should track min, max, and average latency', () => {
      recordRequest('GET', '/api/v2/devices', 200, 10);
      recordRequest('GET', '/api/v2/devices', 200, 50);
      recordRequest('GET', '/api/v2/devices', 200, 30);

      const snapshot = getMetricsSnapshot();
      const requests = snapshot.requests as Record<string, unknown>;
      const latency = requests.latency as Record<string, unknown>;
      const entry = latency['GET:/api/v2/devices'] as Record<string, number>;

      expect(entry.count).toBe(3);
      expect(entry.avgDuration).toBe(30); // (10 + 50 + 30) / 3 = 30
      expect(entry.minDuration).toBe(10);
      expect(entry.maxDuration).toBe(50);
    });

    it('should track different endpoints separately', () => {
      recordRequest('GET', '/api/v2/devices', 200, 50);
      recordRequest('POST', '/api/v2/devices', 201, 100);
      recordRequest('GET', '/api/v2/readings', 200, 75);

      const snapshot = getMetricsSnapshot();
      const requests = snapshot.requests as Record<string, unknown>;
      const counts = requests.counts as Record<string, number>;

      expect(counts['GET:/api/v2/devices:200']).toBe(1);
      expect(counts['POST:/api/v2/devices:201']).toBe(1);
      expect(counts['GET:/api/v2/readings:200']).toBe(1);
    });

    it('should track different status codes separately', () => {
      recordRequest('GET', '/api/v2/devices', 200, 50);
      recordRequest('GET', '/api/v2/devices', 404, 30);
      recordRequest('GET', '/api/v2/devices', 500, 20);

      const snapshot = getMetricsSnapshot();
      const requests = snapshot.requests as Record<string, unknown>;
      const counts = requests.counts as Record<string, number>;

      expect(counts['GET:/api/v2/devices:200']).toBe(1);
      expect(counts['GET:/api/v2/devices:404']).toBe(1);
      expect(counts['GET:/api/v2/devices:500']).toBe(1);
    });
  });

  describe('recordError()', () => {
    it('should record errors by code', () => {
      recordError('VALIDATION_ERROR');

      const snapshot = getMetricsSnapshot();
      const errors = snapshot.errors as Record<string, number>;

      expect(errors['VALIDATION_ERROR']).toBe(1);
    });

    it('should increment error count on repeated errors', () => {
      recordError('NOT_FOUND');
      recordError('NOT_FOUND');
      recordError('NOT_FOUND');

      const snapshot = getMetricsSnapshot();
      const errors = snapshot.errors as Record<string, number>;

      expect(errors['NOT_FOUND']).toBe(3);
    });

    it('should track different error codes separately', () => {
      recordError('VALIDATION_ERROR');
      recordError('NOT_FOUND');
      recordError('INTERNAL_ERROR');

      const snapshot = getMetricsSnapshot();
      const errors = snapshot.errors as Record<string, number>;

      expect(errors['VALIDATION_ERROR']).toBe(1);
      expect(errors['NOT_FOUND']).toBe(1);
      expect(errors['INTERNAL_ERROR']).toBe(1);
    });
  });

  describe('recordRateLimitHit()', () => {
    it('should record rate limit hits by type', () => {
      recordRateLimitHit('ip');

      const snapshot = getMetricsSnapshot();
      const rateLimit = snapshot.rateLimit as Record<string, Record<string, number>>;

      expect(rateLimit.hits['ip']).toBe(1);
    });

    it('should track different rate limit types', () => {
      recordRateLimitHit('ip');
      recordRateLimitHit('device');
      recordRateLimitHit('apiKey');
      recordRateLimitHit('ip');

      const snapshot = getMetricsSnapshot();
      const rateLimit = snapshot.rateLimit as Record<string, Record<string, number>>;

      expect(rateLimit.hits['ip']).toBe(2);
      expect(rateLimit.hits['device']).toBe(1);
      expect(rateLimit.hits['apiKey']).toBe(1);
    });
  });

  describe('recordCacheEvent()', () => {
    it('should record cache hits', () => {
      recordCacheEvent('hit');
      recordCacheEvent('hit');

      const snapshot = getMetricsSnapshot();
      const cache = snapshot.cache as Record<string, number | string>;

      expect(cache.hits).toBe(2);
    });

    it('should record cache misses', () => {
      recordCacheEvent('miss');

      const snapshot = getMetricsSnapshot();
      const cache = snapshot.cache as Record<string, number | string>;

      expect(cache.misses).toBe(1);
    });

    it('should record cache sets', () => {
      recordCacheEvent('set');
      recordCacheEvent('set');
      recordCacheEvent('set');

      const snapshot = getMetricsSnapshot();
      const cache = snapshot.cache as Record<string, number | string>;

      expect(cache.sets).toBe(3);
    });

    it('should record cache invalidations', () => {
      recordCacheEvent('invalidate');

      const snapshot = getMetricsSnapshot();
      const cache = snapshot.cache as Record<string, number | string>;

      expect(cache.invalidations).toBe(1);
    });

    it('should calculate correct hit rate', () => {
      recordCacheEvent('hit');
      recordCacheEvent('hit');
      recordCacheEvent('hit');
      recordCacheEvent('miss');

      const snapshot = getMetricsSnapshot();
      const cache = snapshot.cache as Record<string, number | string>;

      expect(cache.hitRate).toBe('75.00%');
    });

    it('should return 0% hit rate when no cache operations', () => {
      const snapshot = getMetricsSnapshot();
      const cache = snapshot.cache as Record<string, number | string>;

      expect(cache.hitRate).toBe('0.00%');
    });
  });

  describe('recordIngestion()', () => {
    it('should record ingestion batch', () => {
      recordIngestion(1000, 5);

      const snapshot = getMetricsSnapshot();
      const ingestion = snapshot.ingestion as Record<string, number | string>;

      expect(ingestion.total).toBe(1000);
      expect(ingestion.errors).toBe(5);
      expect(ingestion.lastBatchSize).toBe(1000);
    });

    it('should accumulate ingestion totals', () => {
      recordIngestion(1000, 5);
      recordIngestion(500, 2);
      recordIngestion(200, 0);

      const snapshot = getMetricsSnapshot();
      const ingestion = snapshot.ingestion as Record<string, number | string>;

      expect(ingestion.total).toBe(1700);
      expect(ingestion.errors).toBe(7);
      expect(ingestion.lastBatchSize).toBe(200); // Last batch size
    });

    it('should calculate success rate', () => {
      recordIngestion(100, 10); // 90% success

      const snapshot = getMetricsSnapshot();
      const ingestion = snapshot.ingestion as Record<string, number | string>;

      expect(ingestion.successRate).toBe('90.00%');
    });

    it('should return 100% success rate when no ingestion', () => {
      const snapshot = getMetricsSnapshot();
      const ingestion = snapshot.ingestion as Record<string, number | string>;

      expect(ingestion.successRate).toBe('100.00%');
    });
  });

  describe('recordDatabaseQuery()', () => {
    it('should record database query', () => {
      recordDatabaseQuery(50);

      const snapshot = getMetricsSnapshot();
      const database = snapshot.database as Record<string, number>;

      expect(database.queryCount).toBe(1);
      expect(database.totalQueryTime).toBe(50);
    });

    it('should track slow queries', () => {
      recordDatabaseQuery(50, false);
      recordDatabaseQuery(200, true); // Slow query
      recordDatabaseQuery(150, true); // Slow query

      const snapshot = getMetricsSnapshot();
      const database = snapshot.database as Record<string, number>;

      expect(database.queryCount).toBe(3);
      expect(database.slowQueries).toBe(2);
    });

    it('should calculate average query time', () => {
      recordDatabaseQuery(10);
      recordDatabaseQuery(20);
      recordDatabaseQuery(30);

      const snapshot = getMetricsSnapshot();
      const database = snapshot.database as Record<string, number>;

      expect(database.avgQueryTime).toBe(20); // (10 + 20 + 30) / 3 = 20
    });

    it('should return 0 avg time when no queries', () => {
      const snapshot = getMetricsSnapshot();
      const database = snapshot.database as Record<string, number>;

      expect(database.avgQueryTime).toBe(0);
    });
  });

  // ==========================================================================
  // SNAPSHOT FUNCTIONS
  // ==========================================================================

  describe('getMetricsSnapshot()', () => {
    it('should return complete snapshot structure', () => {
      const snapshot = getMetricsSnapshot();

      expect(snapshot).toHaveProperty('requests');
      expect(snapshot).toHaveProperty('errors');
      expect(snapshot).toHaveProperty('rateLimit');
      expect(snapshot).toHaveProperty('cache');
      expect(snapshot).toHaveProperty('ingestion');
      expect(snapshot).toHaveProperty('database');
      expect(snapshot).toHaveProperty('timestamp');
    });

    it('should include ISO timestamp', () => {
      const snapshot = getMetricsSnapshot();

      expect(snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should return empty counts when no data recorded', () => {
      const snapshot = getMetricsSnapshot();
      const requests = snapshot.requests as Record<string, unknown>;

      expect(requests.latency).toEqual({});
      expect(requests.counts).toEqual({});
      expect(snapshot.errors).toEqual({});
    });

    it('should handle min/max edge cases for empty latency', () => {
      // When no requests, latency should be empty
      const snapshot = getMetricsSnapshot();
      const requests = snapshot.requests as Record<string, unknown>;
      const latency = requests.latency as Record<string, unknown>;

      expect(Object.keys(latency)).toHaveLength(0);
    });
  });

  describe('getPrometheusMetrics()', () => {
    it('should return valid Prometheus format', () => {
      recordRequest('GET', '/api/v2/devices', 200, 50);
      recordError('NOT_FOUND');
      recordCacheEvent('hit');
      recordIngestion(100, 0);
      recordDatabaseQuery(30);

      const prometheusOutput = getPrometheusMetrics();

      // Check for metric type declarations
      expect(prometheusOutput).toContain('# HELP http_request_duration_ms');
      expect(prometheusOutput).toContain('# TYPE http_request_duration_ms histogram');
      expect(prometheusOutput).toContain('# HELP http_requests_total');
      expect(prometheusOutput).toContain('# TYPE http_requests_total counter');
      expect(prometheusOutput).toContain('# HELP api_errors_total');
      expect(prometheusOutput).toContain('# HELP rate_limit_hits_total');
      expect(prometheusOutput).toContain('# HELP cache_hits_total');
      expect(prometheusOutput).toContain('# HELP ingestion_readings_total');
      expect(prometheusOutput).toContain('# HELP db_queries_total');
    });

    it('should include request latency metrics with labels', () => {
      recordRequest('GET', '/api/v2/devices', 200, 50);

      const output = getPrometheusMetrics();

      expect(output).toContain('http_request_duration_ms_count{method="GET",path="/api/v2/devices"} 1');
      expect(output).toContain('http_request_duration_ms_sum{method="GET",path="/api/v2/devices"} 50');
    });

    it('should include request count metrics with status labels', () => {
      recordRequest('POST', '/api/v2/readings', 201, 100);

      const output = getPrometheusMetrics();

      expect(output).toContain('http_requests_total{method="POST",path="/api/v2/readings",status="201"} 1');
    });

    it('should include error metrics', () => {
      recordError('VALIDATION_ERROR');
      recordError('VALIDATION_ERROR');

      const output = getPrometheusMetrics();

      expect(output).toContain('api_errors_total{code="VALIDATION_ERROR"} 2');
    });

    it('should include rate limit metrics', () => {
      recordRateLimitHit('ip');

      const output = getPrometheusMetrics();

      expect(output).toContain('rate_limit_hits_total{type="ip"} 1');
    });

    it('should include cache metrics', () => {
      recordCacheEvent('hit');
      recordCacheEvent('miss');

      const output = getPrometheusMetrics();

      expect(output).toContain('cache_hits_total 1');
      expect(output).toContain('cache_misses_total 1');
    });

    it('should include ingestion metrics', () => {
      recordIngestion(500, 3);

      const output = getPrometheusMetrics();

      expect(output).toContain('ingestion_readings_total 500');
      expect(output).toContain('ingestion_errors_total 3');
    });

    it('should include database metrics', () => {
      recordDatabaseQuery(100);
      recordDatabaseQuery(200, true);

      const output = getPrometheusMetrics();

      expect(output).toContain('db_queries_total 2');
      expect(output).toContain('db_slow_queries_total 1');
    });

    it('should return newline-separated output', () => {
      recordRequest('GET', '/api/v2/devices', 200, 50);

      const output = getPrometheusMetrics();
      const lines = output.split('\n');

      expect(lines.length).toBeGreaterThan(10);
    });
  });

  // ==========================================================================
  // RESET FUNCTION
  // ==========================================================================

  describe('resetMetrics()', () => {
    it('should clear all recorded metrics', () => {
      // Record some metrics
      recordRequest('GET', '/api/v2/devices', 200, 50);
      recordError('NOT_FOUND');
      recordRateLimitHit('ip');
      recordCacheEvent('hit');
      recordIngestion(100, 0);
      recordDatabaseQuery(50);

      // Reset
      resetMetrics();

      // Verify all cleared
      const snapshot = getMetricsSnapshot();
      const requests = snapshot.requests as Record<string, unknown>;
      const cache = snapshot.cache as Record<string, number | string>;
      const ingestion = snapshot.ingestion as Record<string, number | string>;
      const database = snapshot.database as Record<string, number>;

      expect(requests.latency).toEqual({});
      expect(requests.counts).toEqual({});
      expect(snapshot.errors).toEqual({});
      expect(cache.hits).toBe(0);
      expect(cache.misses).toBe(0);
      expect(ingestion.total).toBe(0);
      expect(database.queryCount).toBe(0);
    });
  });
});
