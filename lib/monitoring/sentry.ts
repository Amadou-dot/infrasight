/**
 * Sentry Integration
 *
 * Sentry itself stays optional — every helper here is a no-op when no
 * `SENTRY_DSN` is configured. Thin wrapper over the `@sentry/nextjs` module
 * singleton, used by
 * `withErrorHandler` and by `lib/alerting`'s swallowed-failure escalation.
 *
 * WHY THIS FILE IMPORTS SENTRY STATICALLY AND GATES ON CONFIGURATION:
 *
 * Production never calls `initSentry()`. Next.js initializes Sentry through
 * `instrumentation.ts` -> `sentry.server.config.ts` / `sentry.edge.config.ts`,
 * each of which calls `Sentry.init()` on the `@sentry/nextjs` module singleton.
 * An earlier version of this file lazily `await import(...)`-ed the SDK inside
 * `initSentry()`, stashed it in a module-local, and gated every capture helper
 * on that local being populated. Since nothing in production ever called
 * `initSentry()`, the local stayed `null` and EVERY `captureException()` in the
 * codebase returned early — the escalation path was dead code across the whole
 * app, and the only thing that hid it was a unit test that called
 * `initSentry()` itself, which production does not do.
 *
 * So: the helpers below talk to the same module singleton the Next.js config
 * files initialize, and they gate on `isSentryConfigured()` (is a DSN set at
 * all?) rather than on this module's private state. Do not reintroduce a
 * module-local initialization flag as a precondition for capturing.
 *
 * The import is static rather than dynamic on purpose. `@sentry/nextjs` is a
 * hard dependency (package.json), the `sentry.*.config.ts` files already import
 * it statically, and the dynamic import is what created the
 * initialization-order trap in the first place.
 */

import * as Sentry from '@sentry/nextjs';

/**
 * Guards `initSentry()`'s idempotency and NOTHING else. Deliberately not
 * consulted by any capture helper — see the file header: making it a
 * precondition is exactly how the escalation path became dead code.
 */
let sentryInitialized = false;

/**
 * Check if Sentry is configured
 */
export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

/**
 * Initialize Sentry if configured.
 *
 * Retained for entry points that are NOT Next.js request handlers (standalone
 * scripts under `scripts/v2/`, one-off tooling) and re-exported from
 * `lib/monitoring/index.ts`. Inside the Next.js server and edge runtimes this
 * is redundant: `instrumentation.ts` has already initialized the same
 * singleton, and calling this again would just re-`init()` it.
 *
 * Calling it is NOT a precondition for `captureException()` / `captureMessage()`
 * / `addBreadcrumb()` to reach Sentry.
 */
export async function initSentry(): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) return false;

  if (sentryInitialized) return true;

  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      // Sample rate for performance monitoring (10% in production)
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      // Capture unhandled promise rejections
      integrations: [],
      // Filter out known operational errors
      beforeSend(event) {
        // Don't send rate limit errors to Sentry (expected behavior)
        if (event.exception?.values?.[0]?.value?.includes('RATE_LIMIT')) return null;

        // Don't send validation errors (user input issues)
        if (event.exception?.values?.[0]?.value?.includes('VALIDATION_ERROR')) return null;

        return event;
      },
    });

    sentryInitialized = true;
    console.log('[Sentry] Initialized successfully');
    return true;
  } catch (error) {
    console.warn('[Sentry] Failed to initialize:', (error as Error).message);
    return false;
  }
}

/**
 * Capture an exception to Sentry.
 *
 * `context` lands under Sentry's "Additional Data" (`extra`) — searchable but not filterable.
 * `tags` are indexed, filterable facets (Sentry's Tags panel / issue search). Pass a coarse
 * classifier like `{ subsystem: 'alerting' }` as `tags`, not folded into `context` — nesting it
 * under `extra` (e.g. `captureException(err, { tags: {...} })`) does NOT make it a real tag, it
 * just produces a literal `tags` key inside Additional Data.
 *
 * Gated on DSN configuration, never on `initSentry()` having run — see the file
 * header. With no DSN the SDK is inert anyway, but returning early keeps the
 * documented `undefined` return that callers use to mean "not escalated".
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>,
  tags?: Record<string, string>
): string | undefined {
  if (!isSentryConfigured()) return undefined;

  return Sentry.captureException(error, {
    extra: context,
    ...(tags ? { tags } : {}),
  });
}

/**
 * Capture a message to Sentry
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>
): string | undefined {
  if (!isSentryConfigured()) return undefined;

  return Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info'
): void {
  if (!isSentryConfigured()) return;

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level,
  });
}

/**
 * Set user context for error tracking
 */
export function setUser(
  user: {
    id?: string;
    email?: string;
    username?: string;
    [key: string]: unknown;
  } | null
): void {
  if (!isSentryConfigured()) return;

  Sentry.setUser(user);
}

/**
 * Set additional context tags
 */
export function setTag(key: string, value: string): void {
  if (!isSentryConfigured()) return;

  Sentry.setTag(key, value);
}

/**
 * Set extra context data
 */
export function setExtra(key: string, value: unknown): void {
  if (!isSentryConfigured()) return;

  Sentry.setExtra(key, value);
}

/**
 * Start a new transaction for performance monitoring
 */
export function startTransaction(name: string, op: string): { finish: () => void } | undefined {
  if (!isSentryConfigured()) return undefined;

  const transaction = Sentry.startInactiveSpan({
    name,
    op,
  });

  return {
    finish: () => transaction?.end(),
  };
}

/**
 * Wrap a function with Sentry error handling
 */
export function withSentryErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: Record<string, unknown>
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      captureException(error as Error, { ...context, args });
      throw error;
    }
  }) as T;
}
