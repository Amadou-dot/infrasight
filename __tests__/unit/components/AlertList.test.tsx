/**
 * AlertList Tests
 *
 * `@/lib/query/hooks` and `@/components/alerts/useAlertFilterParams` are
 * mocked at the exact module specifiers AlertList.tsx imports from (matching
 * the working pattern in DashboardStatCards.test.tsx) so the mock actually
 * intercepts the import AlertList uses, rather than a barrel re-export that
 * never gets hit.
 *
 * `useAdminAction`/`useRbac` (lib/auth/rbac-client.tsx) are deliberately NOT
 * mocked — only their dependency on Clerk's `useAuth` is stubbed, exactly like
 * __tests__/unit/lib/rbac-client.test.ts does for useRbac directly. That way
 * these tests exercise the real gating contract end to end (mocking
 * useAdminAction itself would only prove AlertList reads a mock correctly,
 * not that the wiring to the real hook is correct — which is the class of bug
 * fixed in this round: AlertList previously hand-rolled its own isAdmin
 * gating instead of using useAdminAction()).
 *
 * The admin-gated Acknowledge/Resolve buttons are the focus. Per
 * useAdminAction's three-branch contract: an admin sees them enabled; a
 * non-admin in demo mode sees them present-and-disabled with a tooltip (so a
 * visitor can see the workflow exists); a non-admin outside demo mode sees
 * them absent entirely (matching every other admin-gated control in the
 * app — app/devices/page.tsx, app/analytics/page.tsx, app/maintenance/page.tsx,
 * app/page.tsx). All three branches are asserted below, and the
 * deletion-check evidence proving each one actually catches a regression is
 * recorded in the task report.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertList, formatRelativeTime } from '@/components/alerts/AlertList';
import type { AlertV2Response } from '@/types/v2';
// Namespace TYPE imports, used only to annotate the `jest.requireActual`
// calls further down. `import type` is erased entirely at transpile, so
// neither of these emits a runtime import — which matters here rather than
// being a stylistic nicety: a VALUE import of '@/lib/query/hooks' would pull
// the real module in and defeat the `jest.mock` these tests depend on.
import type * as AlertQueryHooks from '@/lib/query/hooks';
import type * as UseAlertFilterParamsModule from '@/components/alerts/useAlertFilterParams';

const mockUseAlertsList = jest.fn();
const mockAcknowledgeMutate = jest.fn();
const mockResolveMutate = jest.fn();
const mockRefetch = jest.fn();
let acknowledgeIsPending = false;
let resolveIsPending = false;

jest.mock('@/lib/query/hooks', () => ({
  useAlertsList: (...args: unknown[]) => mockUseAlertsList(...args),
  useAcknowledgeAlert: () => ({ mutate: mockAcknowledgeMutate, isPending: acknowledgeIsPending }),
  useResolveAlert: () => ({ mutate: mockResolveMutate, isPending: resolveIsPending }),
}));

const mockUseAuth = jest.fn();
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseAlertFilterParams = jest.fn();
jest.mock('@/components/alerts/useAlertFilterParams', () => ({
  useAlertFilterParams: (...args: unknown[]) => mockUseAlertFilterParams(...args),
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('react-toastify', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// --- D3: real-hook wiring for the "URL -> query integration" block below --
//
// `useAlertsList` and `useAlertFilterParams` stay mocked (as above) for
// every OTHER describe block in this file — those `actual*` references
// below let ONE block opt back into the real implementations via
// `mockUseAlertsList.mockImplementation(actualAlertHooks.useAlertsList)`,
// so that block exercises the real URL -> filters -> query wiring end to
// end, instead of two mocks that describe each other's shape but never
// actually meet (the review's exact D3 complaint). `next/navigation` and
// `v2Api.alerts.list` are mocked instead — the network boundary, not the
// hooks under test — mirroring AlertDetailPage.test.tsx's established
// `jest.requireActual(...)` partial-mock idiom.
const actualAlertHooks = jest.requireActual('@/lib/query/hooks') as typeof AlertQueryHooks;
const actualUseAlertFilterParams = (
  jest.requireActual(
    '@/components/alerts/useAlertFilterParams'
  ) as typeof UseAlertFilterParamsModule
).useAlertFilterParams;

const mockV2ApiAlertsList = jest.fn();
jest.mock('@/lib/api/v2-client', () => {
  const actual = jest.requireActual('@/lib/api/v2-client');
  return {
    ...actual,
    v2Api: {
      ...actual.v2Api,
      alerts: {
        ...actual.v2Api.alerts,
        list: (...args: unknown[]) => mockV2ApiAlertsList(...args),
      },
    },
  };
});

// Minimal but faithful next/navigation mock: `push` both records the call
// AND updates what `useSearchParams` returns (via useSyncExternalStore), so
// clicking a real pagination control drives a real re-render off the new
// URL — exactly what AlertList.tsx experiences in the browser. Declared
// once at file scope; inert for every other describe block below, since
// nothing there calls a real next/navigation hook (useAlertFilterParams is
// mocked away in those blocks).
const mockNavState: { search: string; listeners: Set<() => void> } = {
  search: '',
  listeners: new Set(),
};
// The second parameter mirrors next/navigation's real `push(href, options?)`
// signature. It is declared but unused: the mock only needs `href` to drive
// `useSearchParams`, while `jest.fn`'s recorded calls keep whatever the second
// argument was for the assertions below. Typing it is not cosmetic — without
// it the `push` wrapper at the useRouter mock spreads two arguments into a
// one-argument function, which is a `tsc` error that ts-jest's transpile-only
// mode does not surface.
const mockRouterPush = jest.fn((url: string, _options?: unknown) => {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  mockNavState.search = query;
  mockNavState.listeners.forEach(listener => listener());
});

jest.mock('next/navigation', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: (...args: [string, unknown?]) => mockRouterPush(...args) }),
    usePathname: () => '/alerts',
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          (onStoreChange: () => void) => {
            mockNavState.listeners.add(onStoreChange);
            return () => mockNavState.listeners.delete(onStoreChange);
          },
          () => mockNavState.search
        )
      ),
  };
});

function signedInAs(orgRole: 'org:admin' | 'org:member', orgSlug = 'users') {
  mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, orgRole, orgSlug });
}

function setDemoMode(value: 'true' | undefined) {
  if (value === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = value;
}

const ORIGINAL_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE;

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
    trigger_value: 35,
    last_value: 35,
    breached_since: '2026-08-01T12:00:00.000Z',
    last_observed_at: '2026-08-01T12:05:00.000Z',
    fired_at: '2026-08-01T12:00:00.000Z',
    audit: {
      created_at: '2026-08-01T12:00:00.000Z',
      created_by: 'system',
      updated_at: '2026-08-01T12:00:00.000Z',
      updated_by: 'system',
    },
    ...overrides,
  };
}

function defaultFilterParams() {
  return {
    status: 'open',
    severity: 'all',
    page: 1,
    setStatus: jest.fn(),
    setSeverity: jest.fn(),
    setPage: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Fixed 5 minutes after the default fixture's fired_at, so relative-time
  // assertions are deterministic (also matches the fixture's last_observed_at).
  jest.setSystemTime(new Date('2026-08-01T12:05:00.000Z'));
  acknowledgeIsPending = false;
  resolveIsPending = false;
  setDemoMode(undefined);
  // Most tests below don't care about role; default to admin so
  // Acknowledge/Resolve are visible+enabled unless a test says otherwise.
  signedInAs('org:admin');
  mockUseAlertFilterParams.mockReturnValue(defaultFilterParams());
  mockUseAlertsList.mockReturnValue({
    data: [makeAlert()],
    isLoading: false,
    error: null,
    refetch: mockRefetch,
    isFetching: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
  setDemoMode(ORIGINAL_DEMO_MODE as 'true' | undefined);
});

describe('AlertList', () => {
  describe('rendering rows', () => {
    it('should render severity, status, rule name, device id, a plain-language condition, and a relative timestamp', () => {
      render(<AlertList />);

      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText('Firing')).toBeInTheDocument();
      expect(screen.getByText('High temperature')).toBeInTheDocument();
      expect(screen.getByText('device_001')).toBeInTheDocument();
      expect(screen.getByText(/value above 30/)).toBeInTheDocument();
      expect(screen.getByText(/last 35/)).toBeInTheDocument();
      // fired_at is 12:00:00.000Z, fixed "now" is 12:05:00.000Z.
      expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
    });

    it('should call onDeviceClick with the device id when the device button is clicked', () => {
      const onDeviceClick = jest.fn();

      render(<AlertList onDeviceClick={onDeviceClick} />);
      fireEvent.click(screen.getByText('device_001'));

      expect(onDeviceClick).toHaveBeenCalledWith('device_001');
    });

    it('should fall back to breached_since for the relative timestamp when fired_at is absent', () => {
      mockUseAlertsList.mockReturnValue({
        data: [makeAlert({ fired_at: undefined, breached_since: '2026-08-01T10:00:00.000Z' })],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertList />);

      // fixed "now" is 12:05:00.000Z; breached_since is 2h05m earlier, which
      // rounds to "2 hours ago" — proves the row used breached_since, not a
      // crash or blank on the missing fired_at.
      expect(screen.getByText('2 hours ago')).toBeInTheDocument();
    });
  });

  describe('formatRelativeTime', () => {
    it('should describe a handful of seconds as "X seconds ago"', () => {
      jest.setSystemTime(new Date('2026-08-01T12:00:30.000Z'));
      expect(formatRelativeTime('2026-08-01T12:00:00.000Z')).toBe('30 seconds ago');
    });

    it('should describe minutes ago', () => {
      jest.setSystemTime(new Date('2026-08-01T12:05:00.000Z'));
      expect(formatRelativeTime('2026-08-01T12:00:00.000Z')).toBe('5 minutes ago');
    });

    it('should describe hours ago', () => {
      jest.setSystemTime(new Date('2026-08-01T14:00:00.000Z'));
      expect(formatRelativeTime('2026-08-01T12:00:00.000Z')).toBe('2 hours ago');
    });

    it('should describe days ago', () => {
      jest.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
      expect(formatRelativeTime('2026-08-01T12:00:00.000Z')).toBe('3 days ago');
    });
  });

  describe('loading, error, and empty states', () => {
    it('should show a spinner while loading', () => {
      mockUseAlertsList.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      });

      const { container } = render(<AlertList />);

      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('should show an error message when the query fails', () => {
      mockUseAlertsList.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('network down'),
        refetch: mockRefetch,
      });

      render(<AlertList />);

      expect(screen.getByText('Failed to load alerts')).toBeInTheDocument();
    });

    it('should show "No open alerts." when the list is empty', () => {
      mockUseAlertsList.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertList />);

      expect(screen.getByText('No open alerts.')).toBeInTheDocument();
    });
  });

  // --- The three useAdminAction() branches --------------------------------

  describe('admin gating on Acknowledge/Resolve (via useAdminAction)', () => {
    it('should render Acknowledge and Resolve ENABLED for an admin, with no tooltip', () => {
      signedInAs('org:admin');

      render(<AlertList />);

      const acknowledgeBtn = screen.getByRole('button', { name: /acknowledge/i });
      const resolveBtn = screen.getByRole('button', { name: /resolve/i });

      expect(acknowledgeBtn).not.toBeDisabled();
      expect(acknowledgeBtn).not.toHaveAttribute('title');
      expect(resolveBtn).not.toBeDisabled();
      expect(resolveBtn).not.toHaveAttribute('title');
    });

    it('should render Acknowledge and Resolve PRESENT but DISABLED with a tooltip for a non-admin in demo mode', () => {
      signedInAs('org:member');
      setDemoMode('true');

      render(<AlertList />);

      const acknowledgeBtn = screen.getByRole('button', { name: /acknowledge/i });
      const resolveBtn = screen.getByRole('button', { name: /resolve/i });

      expect(acknowledgeBtn).toBeInTheDocument();
      expect(acknowledgeBtn).toBeDisabled();
      expect(acknowledgeBtn).toHaveAttribute('title', expect.stringMatching(/admin/i));

      expect(resolveBtn).toBeInTheDocument();
      expect(resolveBtn).toBeDisabled();
      expect(resolveBtn).toHaveAttribute('title', expect.stringMatching(/admin/i));
    });

    it('should HIDE Acknowledge and Resolve entirely for a non-admin outside demo mode', () => {
      signedInAs('org:member');
      setDemoMode(undefined);

      render(<AlertList />);

      expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
    });

    it('should not render Acknowledge for an alert that is not firing, regardless of role', () => {
      signedInAs('org:admin');
      mockUseAlertsList.mockReturnValue({
        data: [makeAlert({ status: 'acknowledged', is_open: true })],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertList />);

      expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
    });

    it('should not render Resolve for an alert that is already resolved (not open)', () => {
      signedInAs('org:admin');
      mockUseAlertsList.mockReturnValue({
        data: [makeAlert({ status: 'resolved', is_open: false })],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertList />);

      expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
    });
  });

  describe('admin actions', () => {
    it('should acknowledge with the alert id and toast success on completion', () => {
      signedInAs('org:admin');

      render(<AlertList />);
      fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));

      expect(mockAcknowledgeMutate).toHaveBeenCalledTimes(1);
      const [variables, options] = mockAcknowledgeMutate.mock.calls[0];
      expect(variables).toEqual({ id: 'alert_1' });

      options.onSuccess();
      expect(mockToastSuccess).toHaveBeenCalledWith('Alert acknowledged');

      options.onError(new Error('boom'));
      expect(mockToastError).toHaveBeenCalledWith('boom');
    });

    it('should resolve with the alert id and toast success on completion', () => {
      signedInAs('org:admin');

      render(<AlertList />);
      fireEvent.click(screen.getByRole('button', { name: /resolve/i }));

      expect(mockResolveMutate).toHaveBeenCalledTimes(1);
      const [variables, options] = mockResolveMutate.mock.calls[0];
      expect(variables).toEqual({ id: 'alert_1' });

      options.onSuccess();
      expect(mockToastSuccess).toHaveBeenCalledWith('Alert resolved');
    });
  });

  describe('pagination', () => {
    it('should disable the previous-page control on page 1, discoverable by its accessible name', () => {
      mockUseAlertFilterParams.mockReturnValue({ ...defaultFilterParams(), page: 1 });

      render(<AlertList />);

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    });

    it('should disable the next-page control when a page comes back short of PAGE_SIZE, discoverable by its accessible name', () => {
      mockUseAlertFilterParams.mockReturnValue({ ...defaultFilterParams(), page: 2 });
      mockUseAlertsList.mockReturnValue({
        data: [makeAlert()], // 1 alert, well under PAGE_SIZE (10)
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertList />);

      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });

    // --- B1: a page transition in flight must disable BOTH controls, so a
    // second click cannot skip a page (keepPreviousData keeps isLoading
    // false and the previous page's rows visible during the transition —
    // isFetching is the only signal a transition is in progress at all).
    it('should disable BOTH Previous and Next while a page transition is in flight (isFetching), even though page/count alone would leave them enabled', () => {
      mockUseAlertFilterParams.mockReturnValue({ ...defaultFilterParams(), page: 2 });
      mockUseAlertsList.mockReturnValue({
        // A full page (== PAGE_SIZE) on page 2: neither the page===1 guard
        // nor the short-page guard would disable anything on their own —
        // isFetching must be the thing doing the work here.
        data: Array.from({ length: 10 }, (_, i) => makeAlert({ _id: `alert_${i}` })),
        isLoading: false,
        error: null,
        refetch: mockRefetch,
        isFetching: true,
      });

      render(<AlertList />);

      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });

    it('should also disable the refresh control (and spin its icon) while isFetching', () => {
      mockUseAlertsList.mockReturnValue({
        data: [makeAlert()],
        isLoading: false, // isolates the spin to the refresh icon, not the isLoading spinner
        error: null,
        refetch: mockRefetch,
        isFetching: true,
      });

      const { container } = render(<AlertList />);

      const spinningIcon = container.querySelector('.animate-spin');
      expect(spinningIcon).toBeInTheDocument();
      expect(spinningIcon?.closest('button')).toBeDisabled();
    });
  });

  // --- D3: mockUseAlertsList must actually be asserted against, and a
  // filter change must be observable as a changed call argument — both
  // still using the mocked hooks (this is about AlertList's OWN glue code
  // that builds `filters`, not about the hooks it calls).
  describe('query argument wiring (D3)', () => {
    it('should call useAlertsList with the filter/pagination arguments the current URL state implies', () => {
      mockUseAlertFilterParams.mockReturnValue({
        ...defaultFilterParams(),
        status: 'firing',
        severity: 'critical',
        page: 4,
      });

      render(<AlertList />);

      expect(mockUseAlertsList).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'firing', severity: 'critical', page: 4, limit: 10 })
      );
    });

    it('should produce a different useAlertsList argument when only the filter state changes', () => {
      mockUseAlertFilterParams.mockReturnValue({ ...defaultFilterParams(), status: 'open', page: 1 });
      render(<AlertList />);
      const firstArgs = mockUseAlertsList.mock.calls.at(-1)?.[0];

      mockUseAlertFilterParams.mockReturnValue({
        ...defaultFilterParams(),
        status: 'acknowledged',
        page: 1,
      });
      render(<AlertList />);
      const secondArgs = mockUseAlertsList.mock.calls.at(-1)?.[0];

      expect(secondArgs).not.toEqual(firstArgs);
      expect(secondArgs).toMatchObject({ status: 'acknowledged' });
      // 'open' is the server default, sent absent — not the literal string.
      expect(firstArgs).not.toHaveProperty('status');
    });

    it('should omit status/severity from the useAlertsList call when both filters are at their defaults', () => {
      mockUseAlertFilterParams.mockReturnValue(defaultFilterParams());

      render(<AlertList />);

      const args = mockUseAlertsList.mock.calls.at(-1)?.[0];
      expect(args).not.toHaveProperty('status');
      expect(args).not.toHaveProperty('severity');
      expect(args).toMatchObject({ page: 1, limit: 10 });
    });
  });

  // --- D3: the URL -> useAlertFilterParams -> filters -> useAlertsList ->
  // v2Api.alerts.list chain, exercised with the real hooks (only the
  // network boundary mocked) so a break anywhere in that chain — not just
  // in AlertList's own glue code — would show up here.
  describe('URL -> query integration (D3)', () => {
    function renderWithRealHooks() {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={queryClient}>
          <AlertList />
        </QueryClientProvider>
      );
    }

    beforeEach(() => {
      mockNavState.search = '';
      mockNavState.listeners.clear();
      mockRouterPush.mockClear();
      mockV2ApiAlertsList.mockReset();
      mockV2ApiAlertsList.mockResolvedValue({
        success: true,
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
      mockUseAlertFilterParams.mockImplementation(
        (...args: Parameters<typeof actualUseAlertFilterParams>) =>
          actualUseAlertFilterParams(...args)
      );
      mockUseAlertsList.mockImplementation(
        (...args: Parameters<typeof actualAlertHooks.useAlertsList>) =>
          actualAlertHooks.useAlertsList(...args)
      );
    });

    it('should request the default open/all/page-1 filters (status and severity both omitted) when the URL is bare', async () => {
      renderWithRealHooks();

      await waitFor(() => expect(mockV2ApiAlertsList).toHaveBeenCalled());

      const args = mockV2ApiAlertsList.mock.calls[0][0];
      expect(args).toMatchObject({ page: 1, limit: 10 });
      expect(args).not.toHaveProperty('status');
      expect(args).not.toHaveProperty('severity');
    });

    it('should request the status/severity the URL specifies', async () => {
      mockNavState.search = 'status=firing&severity=critical';

      renderWithRealHooks();

      await waitFor(() => expect(mockV2ApiAlertsList).toHaveBeenCalled());

      expect(mockV2ApiAlertsList).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'firing', severity: 'critical', page: 1, limit: 10 })
      );
    });

    it('should request the page the URL specifies', async () => {
      mockNavState.search = 'page=3';

      renderWithRealHooks();

      await waitFor(() => expect(mockV2ApiAlertsList).toHaveBeenCalled());

      expect(mockV2ApiAlertsList).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));
    });

    it('should advance the query argument to page 2 (not skip to 3) after a single click on Next', async () => {
      // A full page (== PAGE_SIZE) so Next starts enabled.
      mockV2ApiAlertsList.mockResolvedValue({
        success: true,
        data: Array.from({ length: 10 }, (_, i) => makeAlert({ _id: `alert_${i}` })),
        pagination: { page: 1, limit: 10, total: 25, totalPages: 3 },
      });

      renderWithRealHooks();

      // Wait for the fetch to actually SETTLE (not just be called) — data
      // must be in state and isFetching back to false, or the Next button is
      // still disabled (no rows yet means alerts.length < PAGE_SIZE) and the
      // click below would be a no-op that this test could pass vacuously.
      await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled());
      expect(mockV2ApiAlertsList).toHaveBeenCalledTimes(1);
      expect(mockV2ApiAlertsList.mock.calls[0][0]).toMatchObject({ page: 1 });

      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Reaches the real hook's setPage -> router.push with an ADVANCED (not
      // skipped) page — a real click on a real page-1 view pushes to page 2.
      expect(mockRouterPush).toHaveBeenCalledWith('/alerts?page=2', { scroll: false });

      // ...and that URL change flows all the way through to a second,
      // real network call carrying the advanced page — the full loop D3
      // asks for, not just the outgoing push.
      await waitFor(() => expect(mockV2ApiAlertsList).toHaveBeenCalledTimes(2));
      expect(mockV2ApiAlertsList.mock.calls[1][0]).toMatchObject({ page: 2 });
    });
  });
});
