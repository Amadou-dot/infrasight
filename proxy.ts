import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { ApiError } from '@/lib/errors';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/v2/cron/simulate', // Keep simulate public for GitHub Actions cron job
]);

// Check if E2E testing mode is enabled via environment variable
const isE2ETestingMode = process.env.E2E_TESTING === 'true';
const allowedOrgSlugs = (process.env.CLERK_ALLOWED_ORG_SLUGS || 'users')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

export default clerkMiddleware(async (auth, request) => {
  // Skip auth protection in E2E testing mode
  if (isE2ETestingMode) return;

  if (!isPublicRoute(request)) {
    await auth.protect();

    const session = await auth();
    const orgSlug = session.orgSlug?.toLowerCase() || null;
    if (!orgSlug || (allowedOrgSlugs.length > 0 && !allowedOrgSlugs.includes(orgSlug)))
      throw ApiError.forbidden('Organization membership required');
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
