/**
 * Next.js Instrumentation
 *
 * This file is used to register instrumentation hooks.
 * It must export a register function that is called once when Next.js starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
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
