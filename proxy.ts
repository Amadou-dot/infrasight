import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isDemoMode, isDemoReadableMethod } from '@/lib/auth';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/unauthorized',
  '/api/v2/cron/simulate', // Keep simulate public for external scheduler access
]);

// Check if E2E testing mode is enabled via environment variable
const isE2ETestingMode = process.env.NODE_ENV !== 'production' && process.env.E2E_TESTING === 'true';
const allowedOrgSlugs = (process.env.CLERK_ALLOWED_ORG_SLUGS || 'users')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export default clerkMiddleware(async (auth, request) => {
  // Skip auth protection in E2E testing mode
  if (isE2ETestingMode) return;

  if (isPublicRoute(request)) return;

  const session = await auth();
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');

  // Public read-only demo: anonymous visitors may read. A real session always takes
  // precedence, so signed-in users still fall through to the org and role checks below.
  if (!session.userId && isDemoMode() && isDemoReadableMethod(request.method)) return;

  // Signed-out. Send page requests to sign-in rather than letting Clerk rewrite to a 404,
  // which left visitors with no indication that a sign-in page existed at all.
  if (!session.userId) {
    if (isApiRoute) return jsonError('UNAUTHORIZED', 'Authentication required', 401);

    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('redirect_url', request.url);
    return NextResponse.redirect(signInUrl);
  }

  const orgSlug = session.orgSlug?.toLowerCase() || null;
  if (!orgSlug || (allowedOrgSlugs.length > 0 && !allowedOrgSlugs.includes(orgSlug))) {
    // API routes get a JSON 403 error; page routes get a redirect
    if (isApiRoute) return jsonError('FORBIDDEN', 'Organization membership required', 403);

    return NextResponse.redirect(new URL('/unauthorized', request.url));
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
