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
