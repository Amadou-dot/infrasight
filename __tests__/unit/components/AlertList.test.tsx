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

import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AlertList, formatRelativeTime } from '@/components/alerts/AlertList';
import type { AlertV2Response } from '@/types/v2';

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
  });
});
