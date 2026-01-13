export { logger, type LogLevel, type LogContext } from './logger';

export {
  recordRequest,
  recordError,
  recordRateLimitHit,
  recordCacheEvent,
  recordIngestion,
  recordDatabaseQuery,
  getMetricsSnapshot,
  getPrometheusMetrics,
  resetMetrics,
} from './metrics';

export {
  generateTraceId,
  getTraceId,
  addTraceHeaders,
  createRequestTimer,
  withTracing,
  createRequestContext,
  type RequestContext,
} from './tracing';

export {
  isSentryConfigured,
  initSentry,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setExtra,
  startTransaction,
  withSentryErrorHandling,
} from './sentry';
