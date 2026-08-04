/**
 * AlertList Tests
 *
 * `@/lib/query/hooks`, `@/lib/auth/rbac-client`, and
 * `@/components/alerts/useAlertFilterParams` are mocked at the exact module
 * specifiers AlertList.tsx imports from (matching the working pattern in
 * DashboardStatCards.test.tsx) so the mock actually intercepts the import
 * AlertList uses, rather than a barrel re-export that never gets hit.
 *
 * The admin-gated Acknowledge/Resolve buttons are the focus: per the Phase 4
 * demo-mode rule, they must render DISABLED for a non-admin, never hidden, so
 * a visitor can see the workflow exists. A test that only checks the button
 * is disabled would pass vacuously if the button were hidden entirely (the
 * query would throw first); a test that only checks the button is present
 * would pass against a permanently-enabled button. Both are asserted below,
 * for both roles, and the deletion-check evidence proving each half actually
 * catches a regression is recorded in the task report.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AlertList } from '@/components/alerts/AlertList';
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

const mockUseRbac = jest.fn();
jest.mock('@/lib/auth/rbac-client', () => ({
  useRbac: () => mockUseRbac(),
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
  acknowledgeIsPending = false;
  resolveIsPending = false;
  mockUseAlertFilterParams.mockReturnValue(defaultFilterParams());
  mockUseAlertsList.mockReturnValue({
    data: [makeAlert()],
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  });
});

describe('AlertList', () => {
  describe('rendering rows', () => {
    it('should render severity, status, rule name, device id, and a plain-language condition', () => {
      mockUseRbac.mockReturnValue({ isAdmin: false });

      render(<AlertList />);

      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText('Firing')).toBeInTheDocument();
      expect(screen.getByText('High temperature')).toBeInTheDocument();
      expect(screen.getByText('device_001')).toBeInTheDocument();
      expect(screen.getByText(/value above 30/)).toBeInTheDocument();
      expect(screen.getByText(/last 35/)).toBeInTheDocument();
    });

    it('should call onDeviceClick with the device id when the device button is clicked', () => {
      mockUseRbac.mockReturnValue({ isAdmin: false });
      const onDeviceClick = jest.fn();

      render(<AlertList onDeviceClick={onDeviceClick} />);
      fireEvent.click(screen.getByText('device_001'));

      expect(onDeviceClick).toHaveBeenCalledWith('device_001');
    });
  });

  describe('loading, error, and empty states', () => {
    it('should show a spinner while loading', () => {
      mockUseRbac.mockReturnValue({ isAdmin: false });
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
      mockUseRbac.mockReturnValue({ isAdmin: false });
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
      mockUseRbac.mockReturnValue({ isAdmin: false });
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

  // --- The demo-mode requirement: disabled, never hidden ----------------

  describe('admin gating on Acknowledge/Resolve (disabled, never hidden)', () => {
    it('should render Acknowledge and Resolve PRESENT but DISABLED for a non-admin, with an explanatory tooltip', () => {
      mockUseRbac.mockReturnValue({ isAdmin: false });

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

    it('should render Acknowledge and Resolve ENABLED for an admin, with no tooltip', () => {
      mockUseRbac.mockReturnValue({ isAdmin: true });

      render(<AlertList />);

      const acknowledgeBtn = screen.getByRole('button', { name: /acknowledge/i });
      const resolveBtn = screen.getByRole('button', { name: /resolve/i });

      expect(acknowledgeBtn).not.toBeDisabled();
      expect(acknowledgeBtn).not.toHaveAttribute('title');

      expect(resolveBtn).not.toBeDisabled();
      expect(resolveBtn).not.toHaveAttribute('title');
    });

    it('should not render Acknowledge for an alert that is not firing, regardless of role', () => {
      mockUseRbac.mockReturnValue({ isAdmin: true });
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
      mockUseRbac.mockReturnValue({ isAdmin: true });
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
      mockUseRbac.mockReturnValue({ isAdmin: true });

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
      mockUseRbac.mockReturnValue({ isAdmin: true });

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
    it('should disable the previous-page control on page 1', () => {
      mockUseRbac.mockReturnValue({ isAdmin: false });
      mockUseAlertFilterParams.mockReturnValue({ ...defaultFilterParams(), page: 1 });

      const { container } = render(<AlertList />);
      const pager = container.querySelector('.mt-4');
      const [prevBtn] = pager?.querySelectorAll('button') ?? [];

      expect(prevBtn).toBeDisabled();
    });

    it('should disable the next-page control when a page comes back short of PAGE_SIZE', () => {
      mockUseRbac.mockReturnValue({ isAdmin: false });
      mockUseAlertFilterParams.mockReturnValue({ ...defaultFilterParams(), page: 2 });
      mockUseAlertsList.mockReturnValue({
        data: [makeAlert()], // 1 alert, well under PAGE_SIZE (10)
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      const { container } = render(<AlertList />);
      const pager = container.querySelector('.mt-4');
      const buttons = pager?.querySelectorAll('button') ?? [];
      const nextBtn = buttons[buttons.length - 1];

      expect(nextBtn).toBeDisabled();
    });
  });
});
