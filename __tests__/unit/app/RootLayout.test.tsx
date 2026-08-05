/**
 * Root Layout — alert-surface gating
 *
 * WHY THIS FILE EXISTS. Critical 2 was fixed with BOTH mechanisms the human
 * partner asked for: the `private-alerts` channel denies alert data at source,
 * and `<SignedIn>` in `app/layout.tsx` keeps the alert surfaces from mounting
 * for a signed-out visitor. Only the first was covered. Deleting the
 * `<SignedIn>` wrappers left the entire 2218-test suite green, because nothing
 * anywhere rendered `app/layout.tsx` — so one of the two requested mechanisms
 * could be removed by any future refactor without a single red test.
 *
 * That gate is load-bearing on its own terms: `/sign-in` renders INSIDE this
 * layout, so an ungated `AlertToaster` puts the fleet's live alert traffic —
 * rule name, device id, trigger value — on the login page of anyone who can
 * reach it. The private channel is what stops the data arriving; this is what
 * stops it being rendered if it ever does.
 *
 * WHAT IS ASSERTED. Behaviour, not markup: signed out, the alert surfaces do
 * not render; signed in, they do. A test that looked for a `SignedIn` element
 * would pass against a wrapper that renders its children unconditionally,
 * which is the same defect class as the gate it is checking.
 *
 * The `@clerk/nextjs` mock below is therefore the one piece that has to be
 * faithful: `SignedIn` renders children only when there is a session, exactly
 * as Clerk's does (Clerk's also renders nothing while loading; `mockIsSignedIn
 * = false` covers that case identically, which is why the provider itself is
 * deliberately NOT wrapped in the layout).
 *
 * Everything else is stubbed down to a marker so this stays a test of the
 * layout's gating and nothing else. `PusherProvider` in particular must be
 * mocked: the real one opens a socket and its module requires the
 * NEXT_PUBLIC_PUSHER_* env vars at import time.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import RootLayout from '@/app/layout';

/** Flipped per test; read by the `SignedIn` stub below. */
let mockIsSignedIn = true;

jest.mock('@clerk/nextjs', () => ({
  __esModule: true,
  // Clerk's SignedIn renders its children only when a session exists.
  SignedIn: ({ children }: { children: React.ReactNode }) =>
    mockIsSignedIn ? <>{children}</> : null,
}));

// Stylesheets: no transform is configured for .css, so these must not be
// loaded for real.
jest.mock('../../../app/globals.css', () => ({}));
jest.mock('react-toastify/dist/ReactToastify.css', () => ({}));

jest.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}));

jest.mock('@/lib/pusher-context', () => ({
  PusherProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/clerk-theme-provider', () => ({
  ClerkThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/TopNav', () => ({
  __esModule: true,
  default: () => <nav data-testid="top-nav" />,
}));

jest.mock('@/components/DemoBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="demo-banner" />,
}));

// The two gated surfaces. Markers, so presence/absence is unambiguous.
jest.mock('@/components/alerts/AlertToaster', () => ({
  AlertToaster: () => <div data-testid="alert-toaster" />,
}));

jest.mock('@/components/alerts/RealtimeStatusBanner', () => ({
  RealtimeStatusBanner: () => <div data-testid="realtime-status-banner" />,
}));

jest.mock('react-toastify', () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
}));

jest.mock('@tanstack/react-query-devtools', () => ({
  ReactQueryDevtools: () => null,
}));

/**
 * React 19 treats `<html>`, `<head>` and `<body>` as document singletons: it
 * resolves them to the real document's elements rather than creating copies
 * inside the container testing-library hands it. That is what makes rendering
 * a root layout in jsdom work at all, and why `screen` — rooted at
 * `document.body` — finds this layout's output.
 */
function renderLayout() {
  return render(
    <RootLayout>
      <div data-testid="page-content" />
    </RootLayout>
  );
}

describe('RootLayout alert gating', () => {
  // The singleton resolution above still logs one "in HTML, <html> cannot be a
  // child of <div>" per render. Silenced by exact message so everything else
  // React has to say still surfaces.
  const originalConsoleError = console.error;

  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('cannot be a child of')) return;
      originalConsoleError(...(args as Parameters<typeof console.error>));
    };
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  afterEach(() => {
    mockIsSignedIn = true;
  });

  describe('signed out', () => {
    beforeEach(() => {
      mockIsSignedIn = false;
    });

    it('does not render the alert toaster', () => {
      renderLayout();

      // `/sign-in` renders inside this layout. Without the gate, a visitor who
      // has not signed in is shown live alert popups carrying rule_name,
      // device_id and trigger_value.
      expect(screen.queryByTestId('alert-toaster')).not.toBeInTheDocument();
    });

    it('does not render the realtime status banner', () => {
      renderLayout();

      expect(screen.queryByTestId('realtime-status-banner')).not.toBeInTheDocument();
    });

    it('still renders the ungated chrome and the page itself', () => {
      renderLayout();

      // Proves the layout rendered at all, so the two absences above are the
      // gate doing its job rather than a render that silently failed.
      expect(screen.getByTestId('top-nav')).toBeInTheDocument();
      expect(screen.getByTestId('page-content')).toBeInTheDocument();
    });
  });

  describe('signed in', () => {
    beforeEach(() => {
      mockIsSignedIn = true;
    });

    it('renders the alert toaster', () => {
      renderLayout();

      expect(screen.getByTestId('alert-toaster')).toBeInTheDocument();
    });

    it('renders the realtime status banner', () => {
      renderLayout();

      expect(screen.getByTestId('realtime-status-banner')).toBeInTheDocument();
    });
  });
});
