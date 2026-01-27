/**
 * Metrics Collection
 *
 * Tracks application metrics for observability:
 * - API request counts and latencies
 * - Ingestion rates
 * - Error rates
 * - Rate limit hits
 * - Cache hit/miss ratios
 *
 * Uses in-memory storage with optional Prometheus export.
 */

// ============================================================================
// TYPES
// ============================================================================

interface HistogramEntry {
  count: number;
  sum: number;
  min: number;
  max: number;
  lastUpdated: number;
}

interface CounterEntry {
  value: number;
  lastUpdated: number;
}

interface MetricsStore {
  /** Request latency histograms by endpoint */
  requestLatency: Map<string, HistogramEntry>;
  /** Request counts by endpoint and status */
  requestCount: Map<string, CounterEntry>;
  /** Error counts by error code */
  errors: Map<string, CounterEntry>;
  /** Rate limit hit counts by identifier type */
  rateLimitHits: Map<string, CounterEntry>;
  /** Cache stats */
  cache: {
    hits: number;
    misses: number;
    sets: number;
    invalidations: number;
  };
  /** Ingestion stats */
  ingestion: {
    total: number;
    errors: number;
    lastBatchSize: number;
    lastBatchTime: number;
  };
  /** Database query stats */
  database: {
    queryCount: number;
    slowQueries: number;
    totalQueryTime: number;
  };
}

// ============================================================================
// METRICS STORE
// ============================================================================

const metrics: MetricsStore = {
  requestLatency: new Map(),
  requestCount: new Map(),
  errors: new Map(),
  rateLimitHits: new Map(),
  cache: { hits: 0, misses: 0, sets: 0, invalidations: 0 },
  ingestion: { total: 0, errors: 0, lastBatchSize: 0, lastBatchTime: 0 },
  database: { queryCount: 0, slowQueries: 0, totalQueryTime: 0 },
};

// ============================================================================
// RECORDING FUNCTIONS
// ============================================================================

/**
 * Record a request metric with latency
 */
export function recordRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number
): void {
  const now = Date.now();

  // Record latency histogram
  const latencyKey = `${method}:${path}`;
  const existing = metrics.requestLatency.get(latencyKey) || {
    count: 0,
    sum: 0,
    min: Infinity,
    max: -Infinity,
    lastUpdated: 0,
  };

  existing.count++;
  existing.sum += duration;
  existing.min = Math.min(existing.min, duration);
  existing.max = Math.max(existing.max, duration);
  existing.lastUpdated = now;

  metrics.requestLatency.set(latencyKey, existing);

  // Record request count
  const countKey = `${method}:${path}:${statusCode}`;
  const countEntry = metrics.requestCount.get(countKey) || { value: 0, lastUpdated: 0 };
  countEntry.value++;
  countEntry.lastUpdated = now;
  metrics.requestCount.set(countKey, countEntry);
}

/**
 * Record an error by error code
 */
export function recordError(errorCode: string): void {
  const entry = metrics.errors.get(errorCode) || { value: 0, lastUpdated: 0 };
  entry.value++;
  entry.lastUpdated = Date.now();
  metrics.errors.set(errorCode, entry);
}

/**
 * Record a rate limit hit
 */
export function recordRateLimitHit(type: 'ip' | 'device' | 'apiKey'): void {
  const entry = metrics.rateLimitHits.get(type) || { value: 0, lastUpdated: 0 };
  entry.value++;
  entry.lastUpdated = Date.now();
  metrics.rateLimitHits.set(type, entry);
}

/**
 * Record cache event
 */
export function recordCacheEvent(event: 'hit' | 'miss' | 'set' | 'invalidate'): void {
  switch (event) {
    case 'hit':
      metrics.cache.hits++;
      break;
    case 'miss':
      metrics.cache.misses++;
      break;
    case 'set':
      metrics.cache.sets++;
      break;
    case 'invalidate':
      metrics.cache.invalidations++;
      break;
  }
}

/**
 * Record ingestion batch
 */
export function recordIngestion(batchSize: number, errorCount: number): void {
  metrics.ingestion.total += batchSize;
  metrics.ingestion.errors += errorCount;
  metrics.ingestion.lastBatchSize = batchSize;
  metrics.ingestion.lastBatchTime = Date.now();
}

/**
 * Record database query
 */
export function recordDatabaseQuery(duration: number, isSlow = false): void {
  metrics.database.queryCount++;
  metrics.database.totalQueryTime += duration;
  if (isSlow) metrics.database.slowQueries++;
}

// ============================================================================
// SNAPSHOT FUNCTIONS
// ============================================================================

/**
 * Get current metrics snapshot
 */
export function getMetricsSnapshot(): Record<string, unknown> {
  const requestStats: Record<string, unknown> = {};

  for (const [key, entry] of metrics.requestLatency)
    requestStats[key] = {
      count: entry.count,
      avgDuration: entry.count > 0 ? Math.round(entry.sum / entry.count) : 0,
      minDuration: entry.min === Infinity ? 0 : Math.round(entry.min),
      maxDuration: entry.max === -Infinity ? 0 : Math.round(entry.max),
    };

  const requestCounts: Record<string, number> = {};
  for (const [key, entry] of metrics.requestCount) requestCounts[key] = entry.value;

  const errorCounts: Record<string, number> = {};
  for (const [key, entry] of metrics.errors) errorCounts[key] = entry.value;

  const rateLimitCounts: Record<string, number> = {};
  for (const [key, entry] of metrics.rateLimitHits) rateLimitCounts[key] = entry.value;

  const cacheHitRate =
    metrics.cache.hits + metrics.cache.misses > 0
      ? ((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(2)
      : '0.00';

  const ingestionSuccessRate =
    metrics.ingestion.total > 0
      ? (
          ((metrics.ingestion.total - metrics.ingestion.errors) / metrics.ingestion.total) *
          100
        ).toFixed(2)
      : '100.00';

  const avgQueryTime =
    metrics.database.queryCount > 0
      ? Math.round(metrics.database.totalQueryTime / metrics.database.queryCount)
      : 0;

  return {
    requests: {
      latency: requestStats,
      counts: requestCounts,
    },
    errors: errorCounts,
    rateLimit: {
      hits: rateLimitCounts,
    },
    cache: {
      ...metrics.cache,
      hitRate: `${cacheHitRate}%`,
    },
    ingestion: {
      ...metrics.ingestion,
      successRate: `${ingestionSuccessRate}%`,
    },
    database: {
      ...metrics.database,
      avgQueryTime,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Export metrics in Prometheus format
 */
export function getPrometheusMetrics(): string {
  const lines: string[] = [];

  // Request latency histogram
  lines.push('# HELP http_request_duration_ms HTTP request latency in milliseconds');
  lines.push('# TYPE http_request_duration_ms histogram');
  for (const [key, entry] of metrics.requestLatency) {
    const [method, path] = key.split(':');
    const labels = `method="${method}",path="${path}"`;
    lines.push(`http_request_duration_ms_count{${labels}} ${entry.count}`);
    lines.push(`http_request_duration_ms_sum{${labels}} ${entry.sum}`);
  }

  // Request counts
  lines.push('# HELP http_requests_total Total number of HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, entry] of metrics.requestCount) {
    const [method, path, status] = key.split(':');
    const labels = `method="${method}",path="${path}",status="${status}"`;
    lines.push(`http_requests_total{${labels}} ${entry.value}`);
  }

  // Error counts
  lines.push('# HELP api_errors_total Total number of API errors by code');
  lines.push('# TYPE api_errors_total counter');
  for (const [code, entry] of metrics.errors)
    lines.push(`api_errors_total{code="${code}"} ${entry.value}`);

  // Rate limit hits
  lines.push('# HELP rate_limit_hits_total Total number of rate limit hits');
  lines.push('# TYPE rate_limit_hits_total counter');
  for (const [type, entry] of metrics.rateLimitHits)
    lines.push(`rate_limit_hits_total{type="${type}"} ${entry.value}`);

  // Cache metrics
  lines.push('# HELP cache_hits_total Total cache hits');
  lines.push('# TYPE cache_hits_total counter');
  lines.push(`cache_hits_total ${metrics.cache.hits}`);
  lines.push('# HELP cache_misses_total Total cache misses');
  lines.push('# TYPE cache_misses_total counter');
  lines.push(`cache_misses_total ${metrics.cache.misses}`);

  // Ingestion metrics
  lines.push('# HELP ingestion_readings_total Total readings ingested');
  lines.push('# TYPE ingestion_readings_total counter');
  lines.push(`ingestion_readings_total ${metrics.ingestion.total}`);
  lines.push('# HELP ingestion_errors_total Total ingestion errors');
  lines.push('# TYPE ingestion_errors_total counter');
  lines.push(`ingestion_errors_total ${metrics.ingestion.errors}`);

  // Database metrics
  lines.push('# HELP db_queries_total Total database queries');
  lines.push('# TYPE db_queries_total counter');
  lines.push(`db_queries_total ${metrics.database.queryCount}`);
  lines.push('# HELP db_slow_queries_total Total slow database queries');
  lines.push('# TYPE db_slow_queries_total counter');
  lines.push(`db_slow_queries_total ${metrics.database.slowQueries}`);

  return lines.join('\n');
}

/**
 * Reset all metrics (for testing)
 */
export function resetMetrics(): void {
  metrics.requestLatency.clear();
  metrics.requestCount.clear();
  metrics.errors.clear();
  metrics.rateLimitHits.clear();
  metrics.cache = { hits: 0, misses: 0, sets: 0, invalidations: 0 };
  metrics.ingestion = { total: 0, errors: 0, lastBatchSize: 0, lastBatchTime: 0 };
  metrics.database = { queryCount: 0, slowQueries: 0, totalQueryTime: 0 };
}
