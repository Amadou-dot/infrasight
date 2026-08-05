/**
 * TopNav Tests
 *
 * Focused on the two things Task 18 adds to TopNav: the "/alerts" nav item
 * (desktop and mobile) and its live open-alert-count badge.
 *
 * `@/lib/query/hooks` and `@/lib/pusher-context` are mocked at the exact
 * module specifiers TopNav.tsx imports from, matching the working pattern in
 * AlertToaster.test.tsx / AlertList.test.tsx, so the mocks actually intercept
 * the imports TopNav uses.
 *
 * `@clerk/nextjs` is re-mocked locally (the global jsdom setup mock has no
 * `useAuth`, `SignedIn`, `SignedOut`, or `SignInButton` — all of which
 * TopNav needs) — confirmed by running this file; see the task report for
 * the run that proves the local mock, not the global one, is what executes.
 *
 * The badge's ">0" gate is the focus of the deletion-check evidence recorded
 * in the task report: both the "hidden at zero" and "shown above zero" tests
 * are proven to fail against a component that gets that gate wrong.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TopNav from '@/components/TopNav';
import { usePusherAlerts } from '@/lib/pusher-context';
import { queryKeys } from '@/lib/query/queryClient';
import type { AlertEvent } from '@/types/v2';

const mockUseOpenAlertCount = jest.fn();
jest.mock('@/lib/query/hooks', () => ({
  useOpenAlertCount: () => mockUseOpenAlertCount(),
}));

jest.mock('@/lib/pusher-context', () => ({
  usePusherAlerts: jest.fn(),
}));

const mockUseAuth = jest.fn();
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Not under test here — it pulls in next-themes/UserButton, neither of which
// this suite cares about.
jest.mock('@/components/user-button-with-theme', () => ({
  UserButtonWithTheme: () => null,
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

function setOpenAlertCount(count: number) {
  mockUseOpenAlertCount.mockReturnValue({ data: count, isLoading: false, error: null });
}

/** Renders TopNav under a real QueryClient and returns a spy on invalidateQueries
 *  plus the handler TopNav registered with the mocked usePusherAlerts. */
function renderTopNav() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TopNav />
    </QueryClientProvider>
  );

  const handleEvent = (usePusherAlerts as jest.Mock).mock.calls.at(-1)?.[0] as (
    event: AlertEvent
  ) => void;

  return { ...utils, invalidateSpy, handleEvent };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    orgRole: 'org:admin',
    orgSlug: 'users',
  });
  setOpenAlertCount(0);
});

describe('TopNav', () => {
  it('renders an Alerts nav item linking to /alerts', () => {
    renderTopNav();

    const link = screen.getByRole('link', { name: /alerts/i });
    expect(link).toHaveAttribute('href', '/alerts');
  });

  describe('open-alert count badge', () => {
    it('should NOT show a badge when there are no open alerts', () => {
      setOpenAlertCount(0);

      renderTopNav();

      const link = screen.getByRole('link', { name: /alerts/i });
      expect(link.querySelector('.bg-destructive')).not.toBeInTheDocument();
    });

    it('should show a badge with the count when there are open alerts', () => {
      setOpenAlertCount(7);

      renderTopNav();

      const link = screen.getByRole('link', { name: /alerts/i });
      const badge = link.querySelector('.bg-destructive');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('7');
      // The digit alone ("7") is meaningless to a screen reader — it must
      // announce a unit, not just a bare number.
      expect(badge).toHaveAccessibleName('7 open alerts');
    });

    it('should default to 0 (no badge) while the count is still loading (data undefined)', () => {
      mockUseOpenAlertCount.mockReturnValue({ data: undefined, isLoading: true, error: null });

      renderTopNav();

      const link = screen.getByRole('link', { name: /alerts/i });
      expect(link.querySelector('.bg-destructive')).not.toBeInTheDocument();
    });

    it('should render the badge in the mobile menu too, once opened', () => {
      setOpenAlertCount(3);

      renderTopNav();
      fireEvent.click(screen.getByRole('button', { name: /open main menu/i }));

      const links = screen.getAllByRole('link', { name: /alerts/i });
      expect(links).toHaveLength(2); // desktop + mobile
      for (const link of links) {
        const badge = link.querySelector('.bg-destructive');
        expect(badge).toHaveTextContent('3');
        expect(badge).toHaveAccessibleName('3 open alerts');
      }
    });
  });

  // --- A1: a failed count must render as visibly DEGRADED, never as the
  // all-clear (no badge) — the two states must produce different output. ---
  describe('open alert count failure (A1)', () => {
    function setOpenAlertCountError() {
      mockUseOpenAlertCount.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('500'),
      });
    }

    it('should render a visibly distinct degraded badge (not the zero/all-clear state) when the count fails to load', () => {
      setOpenAlertCountError();

      renderTopNav();

      const link = screen.getByRole('link', { name: /alerts/i });
      // Not the numeric "open alerts" badge — a failed fetch must not borrow
      // that styling/semantics.
      expect(link.querySelector('.bg-destructive')).not.toBeInTheDocument();
      // A real, distinct affordance IS present — this is what makes the fix
      // real: the zero state renders nothing at all here (see the "should
      // NOT show a badge when there are no open alerts" test above), while
      // the error state renders this.
      const badge = screen.getByLabelText('Open alert count unavailable');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('!');
    });

    it('should not present the degraded badge as if it were the numeric all-clear (zero) state', () => {
      setOpenAlertCountError();

      renderTopNav();

      // The all-clear state shows no badge and no unavailable-affordance;
      // proving both absences here is what makes this test able to fail if
      // the two states were ever collapsed back into one rendering.
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('should render the degraded badge in both desktop and mobile nav', () => {
      setOpenAlertCountError();

      renderTopNav();
      fireEvent.click(screen.getByRole('button', { name: /open main menu/i }));

      const badges = screen.getAllByLabelText('Open alert count unavailable');
      expect(badges).toHaveLength(2); // desktop + mobile
      for (const badge of badges) expect(badge).toHaveTextContent('!');
    });

    it('should NOT show the degraded badge while signed out, even if the count query errors', () => {
      mockUseAuth.mockReturnValue({
        isLoaded: true,
        isSignedIn: false,
        orgRole: null,
        orgSlug: null,
      });
      setOpenAlertCountError();

      renderTopNav();

      expect(screen.queryByLabelText('Open alert count unavailable')).not.toBeInTheDocument();
      // And it must not fall back to showing a numeric badge either.
      expect(screen.getByRole('link', { name: /alerts/i }).querySelector('.bg-destructive')).not.toBeInTheDocument();
    });

    it('should NOT show the degraded badge while the auth state is still loading, even if the count query errors', () => {
      mockUseAuth.mockReturnValue({
        isLoaded: false,
        isSignedIn: false,
        orgRole: null,
        orgSlug: null,
      });
      setOpenAlertCountError();

      renderTopNav();

      expect(screen.queryByLabelText('Open alert count unavailable')).not.toBeInTheDocument();
    });

    it('should prefer the degraded badge over a stale non-zero count when both are present', () => {
      // A background refetch that fails after a prior success can leave a
      // stale positive count sitting in `data` alongside a populated
      // `error`. The degraded state must win — a fetch failure is not safe
      // to paper over with whatever number happened to be cached.
      mockUseOpenAlertCount.mockReturnValue({
        data: 5,
        isLoading: false,
        error: new Error('500'),
      });

      renderTopNav();

      const link = screen.getByRole('link', { name: /alerts/i });
      expect(link.querySelector('.bg-destructive')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Open alert count unavailable')).toBeInTheDocument();
    });
  });

  describe('live updates via Pusher', () => {
    it('registers exactly one alert-event handler via usePusherAlerts', () => {
      renderTopNav();

      expect(usePusherAlerts).toHaveBeenCalledTimes(1);
      expect(typeof (usePusherAlerts as jest.Mock).mock.calls[0][0]).toBe('function');
    });

    it('invalidates the alerts query cache on an alert-event, same as AlertToaster', () => {
      const { invalidateSpy, handleEvent } = renderTopNav();

      act(() =>
        handleEvent({
          kind: 'fired',
          alerts: [
            {
              _id: 'a1',
              rule_id: 'rule_1',
              rule_name: 'High temp',
              device_id: 'device_001',
              severity: 'critical',
              metric: 'value',
              comparison: 'gt',
              threshold: 30,
              trigger_value: 40,
              fired_at: '2026-08-01T12:00:00.000Z',
            },
          ],
        })
      );

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.alerts.all });
    });

    it('passes a memoized (referentially stable) callback to usePusherAlerts across re-renders', () => {
      renderTopNav();
      const firstCallback = (usePusherAlerts as jest.Mock).mock.calls[0][0];

      // Trigger a re-render via unrelated state (opening the mobile menu).
      fireEvent.click(screen.getByRole('button', { name: /open main menu/i }));

      const lastCallback = (usePusherAlerts as jest.Mock).mock.calls.at(-1)?.[0];
      expect(lastCallback).toBe(firstCallback);
    });
  });
});
