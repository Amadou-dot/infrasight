/**
 * AlertDetailPage Tests
 *
 * Not in task-16-brief.md's literal file list (which only names
 * AlertDetailView.test.tsx), but added per the orchestrator's explicit
 * instruction to report deletion-check evidence for the loading, error/404,
 * and admin-gating states. The page (not AlertDetailView) is where the
 * loading spinner and the notFound()/retry-banner branching actually live —
 * `app/devices/[id]/page.tsx` has no direct test either, precisely because
 * that logic sits in the separately-tested `useDeviceDetail` hook; this page
 * has no such hook (it inlines useAlertDetail + a raw useQuery), so the page
 * itself is what needs a direct test here.
 *
 * Fix round 1 (task-16 review): the bracketing-readings `useQuery` used to be
 * mocked wholesale (`useQuery: () => ({ data: [], isLoading: false })`),
 * which is exactly what let a real bug ship invisibly — the query never
 * specified `limit`/`sortBy`/`sortDirection`, so the endpoint's defaults
 * (limit 20, newest-first) silently truncated the early part of the
 * bracketing window on any device reporting faster than ~90s. That mock is
 * gone. `@tanstack/react-query` now runs for real against a real
 * QueryClient, and `v2Api.readings.list` is mocked at the network boundary
 * instead, so the query's actual params are observable and assertable.
 *
 * `@/lib/query/hooks` (useAlertDetail) and `next/navigation`
 * (useParams/notFound) stay mocked so the page's own loading/error/notFound
 * orchestration can still be driven directly. `AlertDetailView` is mocked to
 * a stub so this file stays scoped to the page's own logic —
 * AlertDetailView.test.tsx already covers the presentational component in
 * depth.
 */

import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AlertDetailPage from '@/app/alerts/[id]/page';
import { ApiClientError } from '@/lib/api/v2-client';
import type { AlertV2Response } from '@/types/v2';
import type { AlertDetailView as AlertDetailViewType } from '@/components/alerts/AlertDetailView';

const mockUseAlertDetail = jest.fn();
const mockAcknowledgeMutate = jest.fn();
const mockResolveMutate = jest.fn();
jest.mock('@/lib/query/hooks', () => ({
  useAlertDetail: (...args: unknown[]) => mockUseAlertDetail(...args),
  // Needed once the "readings error must reach the screen" tests below (A3,
  // fix round 2) render the REAL AlertDetailView instead of the stub —
  // AlertDetailView calls these two directly (mirrors the mock in
  // AlertDetailView.test.tsx). Unused by every other test in this file,
  // which keeps AlertDetailView stubbed.
  useAcknowledgeAlert: () => ({ mutate: mockAcknowledgeMutate, isPending: false }),
  useResolveAlert: () => ({ mutate: mockResolveMutate, isPending: false }),
}));

const mockUseParams = jest.fn();
const mockNotFound = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  notFound: () => mockNotFound(),
}));

// Only readings.list is overridden — everything else (including the real
// ApiClientError class used below to build 404/500 fixtures) stays real.
const mockReadingsList = jest.fn();
jest.mock('@/lib/api/v2-client', () => {
  const actual = jest.requireActual('@/lib/api/v2-client');
  return {
    ...actual,
    v2Api: {
      ...actual.v2Api,
      readings: {
        ...actual.v2Api.readings,
        list: (...args: unknown[]) => mockReadingsList(...args),
      },
    },
  };
});

jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  Link.displayName = 'Link';
  return Link;
});

// AlertDetailView.tsx (rendered for REAL by the "readings error must reach
// the screen" tests below) calls useAdminAction() -> useRbac() -> Clerk's
// useAuth(). The global jsdom setup mock (jest.setup.jsdom.ts) provides
// useUser/useOrganization but not useAuth, so it must be supplied locally —
// the same override AlertDetailView.test.tsx / AlertList.test.tsx already
// apply for the same reason.
const mockUseAuth = jest.fn(() => ({
  isLoaded: true,
  isSignedIn: true,
  orgRole: 'org:admin' as const,
  orgSlug: 'users',
}));
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

// The page's own loading/404/retry-banner orchestration (covered by the
// tests below that don't touch this flag) only needs to know AlertDetailView
// RECEIVED the right alert, so it stays a lightweight stub by default.
//
// Fix round 2 (A3): the "readings error must reach the screen" describe
// block flips `useReal` to render the ACTUAL AlertDetailView instead. This
// is deliberate, not incidental — a stub that only echoes props back would
// keep passing even if the page stopped threading `readingsError` through in
// a way that actually reaches the DOM, which is exactly the regression that
// happened in round 1 (the prop existed but nothing rendered it). Reset to
// false in the top-level beforeEach so it never leaks into other tests.
const mockAlertDetailViewMode: { useReal: boolean } = { useReal: false };
jest.mock('@/components/alerts/AlertDetailView', () => ({
  AlertDetailView: (props: ComponentProps<typeof AlertDetailViewType>) => {
    if (mockAlertDetailViewMode.useReal) {
      // Typed off the `AlertDetailViewType` import already at the top of this
      // file rather than a `typeof import(...)` annotation (banned by
      // consistent-type-imports) or a second namespace import from the same
      // module (banned by import/no-duplicates). Only the one binding this
      // destructure actually takes needs describing. `AlertDetailViewType` is
      // an `import type`, so it is erased at transpile — no runtime import of
      // a module that `jest.mock` is intercepting, and no out-of-scope
      // variable reference inside the factory.
      const { AlertDetailView: Real } = jest.requireActual(
        '@/components/alerts/AlertDetailView'
      ) as { AlertDetailView: typeof AlertDetailViewType };
      return <Real {...props} />;
    }
    return <div data-testid="alert-detail-view">{props.alert.rule_name}</div>;
  },
}));

function makeAlert(overrides: Partial<AlertV2Response> = {}): AlertV2Response {
  return {
    _id: 'alert_1',
    rule_id: 'rule_1',
    rule_name: 'High temperature',
    device_id: 'device_001',
    status: 'firing',
    is_open: true,
    severity: 'critical',
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    trigger_value: 42,
    last_value: 41,
    breached_since: '2026-08-01T12:00:00.000Z',
    last_observed_at: '2026-08-01T12:10:00.000Z',
    fired_at: '2026-08-01T12:05:00.000Z',
    audit: {
      created_at: '2026-08-01T12:00:00.000Z',
      created_by: 'system',
      updated_at: '2026-08-01T12:10:00.000Z',
      updated_by: 'system',
    },
    ...overrides,
  };
}

/** Fresh QueryClient per render — real useQuery, no retries, so a mocked
 * rejection settles immediately instead of retrying into a timeout. */
function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AlertDetailPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAlertDetailViewMode.useReal = false;
  mockUseParams.mockReturnValue({ id: 'alert_1' });
  mockReadingsList.mockResolvedValue({ success: true, data: [] });
});

describe('AlertDetailPage', () => {
  it('should show a loading spinner while the alert is loading, and not render the view or 404', () => {
    mockUseAlertDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
    });

    const { container } = renderPage();

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-detail-view')).not.toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
    // No device_id yet, so the bracketing-readings query must stay disabled.
    expect(mockReadingsList).not.toHaveBeenCalled();
  });

  it('should render the styled not-found state for an alert id that does not resolve (404)', () => {
    mockUseAlertDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiClientError(404, 'ALERT_NOT_FOUND', 'Alert not found'),
      refetch: jest.fn(),
    });

    renderPage();

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('should show a retry banner (not the 404 page) for a non-404 error', () => {
    mockUseAlertDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiClientError(500, 'NETWORK_ERROR', 'Network error occurred'),
      refetch: jest.fn(),
    });

    renderPage();

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    expect(screen.queryByTestId('alert-detail-view')).not.toBeInTheDocument();
  });

  it('should render AlertDetailView once the alert loads, and not call notFound', () => {
    mockUseAlertDetail.mockReturnValue({
      data: makeAlert(),
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    renderPage();

    expect(screen.getByTestId('alert-detail-view')).toHaveTextContent('High temperature');
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('should pass retry: false to useAlertDetail so a 404 does not spin through retries first', () => {
    mockUseAlertDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
    });

    renderPage();

    const [, , config] = mockUseAlertDetail.mock.calls[0];
    expect(config).toMatchObject({ retry: false });
  });

  // --- Bracketing-readings query wiring (fix round 1) ----------------------

  describe('bracketing readings query', () => {
    it('should request an explicit limit and ascending sort, windowed +/-15m on fired_at', async () => {
      mockUseAlertDetail.mockReturnValue({
        data: makeAlert({ fired_at: '2026-08-01T12:05:00.000Z' }),
        isLoading: false,
        error: null,
        refetch: jest.fn(),
      });

      renderPage();

      await waitFor(() => expect(mockReadingsList).toHaveBeenCalledTimes(1));

      expect(mockReadingsList).toHaveBeenCalledWith({
        device_id: 'device_001',
        startDate: '2026-08-01T11:50:00.000Z',
        endDate: '2026-08-01T12:20:00.000Z',
        limit: 100,
        sortBy: 'timestamp',
        sortDirection: 'asc',
      });
    });

    it('should fall back to breached_since when fired_at is absent (pending episodes are never visible, but defend anyway)', async () => {
      mockUseAlertDetail.mockReturnValue({
        data: makeAlert({ fired_at: undefined, breached_since: '2026-08-01T09:00:00.000Z' }),
        isLoading: false,
        error: null,
        refetch: jest.fn(),
      });

      renderPage();

      await waitFor(() => expect(mockReadingsList).toHaveBeenCalledTimes(1));

      expect(mockReadingsList).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: '2026-08-01T08:45:00.000Z',
          endDate: '2026-08-01T09:15:00.000Z',
        })
      );
    });

    it('should not request readings before the alert (and its device_id) has loaded', () => {
      mockUseAlertDetail.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: jest.fn(),
      });

      renderPage();

      expect(mockReadingsList).not.toHaveBeenCalled();
    });
  });

  // --- A3, fix round 2: the readings error must reach the SCREEN, not just
  // AlertDetailView's props. Round 1 added readingsError/onRetryReadings to
  // AlertDetailView and proved (in AlertDetailView.test.tsx) that the prop
  // renders a visually distinct state — but this page never threaded the
  // query's `error`/`refetch` into that prop, so the fix was inert in
  // production. A component-only test can't catch that: it would keep
  // passing even if this page stopped passing the prop entirely. These
  // tests render the REAL AlertDetailView (via mockAlertDetailViewMode)
  // specifically so a regression in the page's own wiring shows up as
  // missing/wrong text on screen, the same way a user would see it.
  describe('readings error must reach the screen (A3, page-level)', () => {
    beforeEach(() => {
      mockAlertDetailViewMode.useReal = true;
      mockUseAlertDetail.mockReturnValue({
        data: makeAlert({ fired_at: '2026-08-01T12:05:00.000Z' }),
        isLoading: false,
        error: null,
        refetch: jest.fn(),
      });
    });

    it('should render a distinct error state (with a retry affordance), not the empty-state copy, when the readings query fails', async () => {
      mockReadingsList.mockRejectedValue(new Error('network down'));

      renderPage();

      await waitFor(() =>
        expect(screen.getByText(/failed to load readings/i)).toBeInTheDocument()
      );
      // Must not collide with the genuinely-empty-response copy.
      expect(screen.queryByText(/no readings in this window/i)).not.toBeInTheDocument();
      // onRetryReadings (the query's own refetch) must have arrived too —
      // proven by the retry affordance actually being on screen.
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('should render "No readings in this window." (and NOT the error affordance) when the readings query succeeds but is genuinely empty', async () => {
      mockReadingsList.mockResolvedValue({ success: true, data: [] });

      renderPage();

      await waitFor(() =>
        expect(screen.getByText(/no readings in this window/i)).toBeInTheDocument()
      );
      expect(screen.queryByText(/failed to load readings/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });
  });
});
