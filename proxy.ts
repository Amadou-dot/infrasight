import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/unauthorized',
  '/api/v2/cron/simulate', // Keep simulate public for GitHub Actions cron job
]);

// Check if E2E testing mode is enabled via environment variable
const isE2ETestingMode = process.env.NODE_ENV !== 'production' && process.env.E2E_TESTING === 'true';
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
    if (!orgSlug || (allowedOrgSlugs.length > 0 && !allowedOrgSlugs.includes(orgSlug))) {
      // API routes get a JSON 403 error; page routes get a redirect
      if (request.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: 'Organization membership required' } },
          { status: 403 }
        );
      }
      const url = new URL('/unauthorized', request.url);
      return NextResponse.redirect(url);
    }
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
