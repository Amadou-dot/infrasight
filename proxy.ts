import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/v2/cron/simulate', // Keep simulate public for GitHub Actions cron job
]);

// Check if E2E testing mode is enabled via environment variable
const isE2ETestingMode = process.env.E2E_TESTING === 'true';

export default clerkMiddleware(async (auth, request) => {
  // Skip auth protection in E2E testing mode
  if (isE2ETestingMode) {
    return;
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
