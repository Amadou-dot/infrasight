# Plan: Replace API Key Auth with Clerk

## Overview

Replace the current API key-based authentication system with Clerk for user authentication. This is a portfolio project with simulated IoT data, so the focus is on a polished user experience rather than machine-to-machine auth.

**Scope:**
- Remove: `lib/auth/` (API key system, RBAC, middleware)
- Add: Clerk integration (user auth, sign-in UI, protected routes)

---

## Phase 1: Remove Current Auth System

### 1.1 Remove Auth Library Files

Delete the entire `lib/auth/` directory:
- `lib/auth/index.ts` - barrel exports
- `lib/auth/apiKeys.ts` - API key parsing/validation
- `lib/auth/middleware.ts` - withAuth, withOptionalAuth wrappers
- `lib/auth/permissions.ts` - RBAC definitions
- `lib/auth/context.ts` - audit trail utilities

### 1.2 Update API Route Using Auth

**File:** `app/api/v2/devices/route.ts`

Remove:
- Import: `withOptionalAuth`, `getAuditUser`, `type RequestContext` from `@/lib/auth`
- Middleware wrapper: `withOptionalAuth(handleCreateDevice)`
- Parameter: `authContext` from handler signature
- Call: `getAuditUser(authContext)` → replace with `'system'` or Clerk user later

### 1.3 Remove Auth Tests

Delete:
- `__tests__/unit/lib/permissions.test.ts` (52 test cases for RBAC)

### 1.4 Clean Up Environment Variables

**Files:** `example.env`, `.env.local`

Remove:
```env
# API Authentication section
API_KEYS=...
```

### 1.5 Update Documentation

**File:** `CLAUDE.md`

Remove/update:
- Phase 5 Authentication & Authorization section
- References to `lib/auth/` in file structure
- API key-related instructions

---

## Phase 2: Install and Configure Clerk

### 2.1 Install Dependencies

```bash
pnpm add @clerk/nextjs
```

### 2.2 Add Environment Variables

**File:** `.env.local`

```env
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

**File:** `example.env`

Add template (without actual keys):
```env
# Clerk Authentication (required)
# Get keys from https://dashboard.clerk.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

---

## Phase 3: Integrate Clerk into Frontend

### 3.1 Update Root Layout

**File:** `app/layout.tsx`

Wrap the app with ClerkProvider:

```tsx
import { ClerkProvider } from '@clerk/nextjs';

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html>
        <body>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <TopNav />
              <main>{children}</main>
            </ThemeProvider>
          </QueryClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
```

### 3.2 Create Sign-In Page

**File:** `app/sign-in/[[...sign-in]]/page.tsx`

Protected dashboard with guest credentials for portfolio viewers:

```tsx
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <SignIn />

        {/* Guest credentials for portfolio visitors */}
        <div className="rounded-lg border bg-muted/50 p-4 text-center text-sm">
          <p className="font-medium">Just browsing?</p>
          <p className="text-muted-foreground">
            Email: <code className="bg-background px-1 rounded">guest@infrasight.demo</code>
          </p>
          <p className="text-muted-foreground">
            Password: <code className="bg-background px-1 rounded">guest123</code>
          </p>
        </div>
      </div>
    </div>
  );
}
```

**Note:** Create the guest account in Clerk dashboard with these credentials.

### 3.3 Create Sign-Up Page

**File:** `app/sign-up/[[...sign-up]]/page.tsx`

```tsx
import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp />
    </div>
  );
}
```

### 3.4 Add Clerk Middleware

**File:** `middleware.ts` (project root)

All dashboard routes protected, only auth pages and API routes are public:

```tsx
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/(.*)',  // API routes remain public (for external integrations)
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
```

**Protected routes:** `/`, `/devices`, `/maintenance`, `/analytics`, `/floor-plan`
**Public routes:** `/sign-in`, `/sign-up`, `/api/*`

### 3.5 Update TopNav with UserButton

**File:** `components/TopNav.tsx`

Add Clerk's UserButton next to theme toggle:

```tsx
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';

// In the navbar right section:
<div className="flex items-center gap-2">
  <ModeToggle />
  <SignedIn>
    <UserButton afterSignOutUrl="/" />
  </SignedIn>
  <SignedOut>
    <SignInButton mode="modal">
      <Button variant="outline" size="sm">Sign In</Button>
    </SignInButton>
  </SignedOut>
</div>
```

### 3.6 Update Dashboard Greeting

**File:** `app/page.tsx`

Replace hardcoded "Admin" with actual user name:

```tsx
import { useUser } from '@clerk/nextjs';

// Inside component:
const { user } = useUser();
const greeting = `${getGreeting()}${user?.firstName ? `, ${user.firstName}` : ''}`;
```

---

## Phase 4: Update Audit Trail (Optional)

If you want to preserve audit functionality with Clerk users:

**File:** `app/api/v2/devices/route.ts`

```tsx
import { auth } from '@clerk/nextjs/server';

// In POST handler:
const { userId } = await auth();
const auditUser = userId || 'anonymous';
```

---

## Files Summary

### Files to Delete
- `lib/auth/index.ts`
- `lib/auth/apiKeys.ts`
- `lib/auth/middleware.ts`
- `lib/auth/permissions.ts`
- `lib/auth/context.ts`
- `__tests__/unit/lib/permissions.test.ts`

### Files to Create
- `app/sign-in/[[...sign-in]]/page.tsx`
- `app/sign-up/[[...sign-up]]/page.tsx`
- `middleware.ts`

### Files to Modify
- `app/layout.tsx` - Add ClerkProvider
- `app/page.tsx` - Use useUser() for greeting
- `app/api/v2/devices/route.ts` - Remove old auth, optionally add Clerk
- `components/TopNav.tsx` - Add UserButton
- `example.env` - Update env var template
- `.env.local` - Add Clerk keys
- `CLAUDE.md` - Update auth documentation

---

## Verification

1. **Build check:** `pnpm build` - should complete without errors
2. **Dev server:** `pnpm dev`
3. **Redirect check:** Navigate to `/` - should redirect to `/sign-in`
4. **Guest credentials:** Sign-in page shows guest account info
5. **Sign-in flow:** Sign in with guest credentials
6. **Dashboard access:** After sign-in, dashboard loads at `/`
7. **User display:** UserButton appears in navbar with user avatar
8. **Greeting:** Dashboard shows "Good Morning, [FirstName]"
9. **Navigation:** All protected routes accessible when signed in
10. **Sign-out:** Click UserButton → Sign out → redirects to `/sign-in`
11. **API routes:** `GET /api/v2/devices` still works without auth (public)

---

## Post-Implementation Cleanup

1. Update `CLAUDE.md` to reflect Clerk-based auth
2. Remove any remaining references to API keys in docs
3. Consider adding Clerk webhook for user sync if needed later
