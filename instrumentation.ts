/**
 * Next.js Instrumentation
 *
 * This file is used to register instrumentation hooks.
 * It must export a register function that is called once when Next.js starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * This is the ONLY production Sentry initialization path. The imported config
 * files call `Sentry.init()` on the `@sentry/nextjs` module singleton;
 * `lib/monitoring/sentry.ts` talks to that same singleton and deliberately does
 * NOT depend on its own `initSentry()` helper, which nothing here calls. See
 * that file's header for why gating capture helpers on a private
 * initialization flag silently disabled every escalation in the app.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs')
    // Server-side Sentry initialization
    await import('./sentry.server.config');

  if (process.env.NEXT_RUNTIME === 'edge')
    // Edge runtime Sentry initialization
    await import('./sentry.edge.config');
}

export const onRequestError = async (
  error: Error & { digest?: string },
  request: { path: string; method: string; headers: { [key: string]: string } },
  context: { routerKind: string; routeType: string; routePath: string; revalidateReason?: string }
) => {
  // Import Sentry dynamically to get the initialized instance
  const Sentry = await import('@sentry/nextjs');

  Sentry.captureException(error, {
    extra: {
      request: {
        path: request.path,
        method: request.method,
      },
      context,
    },
  });
};
