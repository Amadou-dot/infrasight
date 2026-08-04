/**
 * AlertRuleList Tests
 *
 * `@/lib/query/hooks` is mocked at the exact module specifier AlertRuleList.tsx
 * imports from (matching the working pattern in AlertList.test.tsx) so the
 * mock actually intercepts the import AlertRuleList uses.
 *
 * `useAdminAction`/`useRbac` (lib/auth/rbac-client.tsx) are deliberately NOT
 * mocked — only their dependency on Clerk's `useAuth` is stubbed, exactly like
 * AlertList.test.tsx does. That exercises the real gating contract end to end
 * rather than a mock that would pass even if AlertRuleList stopped calling
 * useAdminAction() altogether.
 *
 * The admin-gated enabled-toggle and delete button are the focus. Per
 * useAdminAction's three-branch contract: an admin sees them enabled; a
 * non-admin in demo mode sees them present-and-disabled with a tooltip; a
 * non-admin outside demo mode sees them absent entirely. Deletion-check
 * evidence proving these tests actually catch a regression (rather than
 * passing vacuously) is recorded in the task report.
 *
 * Delete confirmation never uses window.confirm (it blocks the page) — it
 * uses components/ui/alert-dialog.tsx, matching app/devices/page.tsx's
 * established pattern. The tests assert the confirm/cancel flow directly
 * rather than assuming any particular dialog implementation.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AlertRuleList } from '@/components/alerts/AlertRuleList';
import type { AlertRuleV2Response } from '@/types/v2';

const mockUseAlertRulesList = jest.fn();
const mockUpdateMutate = jest.fn();
const mockDeleteMutate = jest.fn();
const mockRefetch = jest.fn();
let updateIsPending = false;
let deleteIsPending = false;

jest.mock('@/lib/query/hooks', () => ({
  useAlertRulesList: (...args: unknown[]) => mockUseAlertRulesList(...args),
  useUpdateAlertRule: () => ({ mutate: mockUpdateMutate, isPending: updateIsPending }),
  useDeleteAlertRule: () => ({ mutate: mockDeleteMutate, isPending: deleteIsPending }),
}));

const mockUseAuth = jest.fn();
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
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

function makeRule(overrides: Partial<AlertRuleV2Response> = {}): AlertRuleV2Response {
  return {
    _id: 'rule_1',
    name: 'High temperature',
    description: 'Alerts when temperature exceeds threshold',
    enabled: true,
    selector: { types: ['temperature'] },
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    for_duration_seconds: 300,
    severity: 'critical',
    cooldown_seconds: 300,
    audit: {
      created_at: '2026-08-01T12:00:00.000Z',
      created_by: 'admin@example.com',
      updated_at: '2026-08-01T12:00:00.000Z',
      updated_by: 'admin@example.com',
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  updateIsPending = false;
  deleteIsPending = false;
  setDemoMode(undefined);
  // Most tests below don't care about role; default to admin so the toggle
  // and delete controls are visible+enabled unless a test says otherwise.
  signedInAs('org:admin');
  mockUseAlertRulesList.mockReturnValue({
    data: [makeRule()],
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  });
});

afterEach(() => {
  setDemoMode(ORIGINAL_DEMO_MODE as 'true' | undefined);
});

describe('AlertRuleList', () => {
  describe('rendering rows', () => {
    it('should render name, severity, a plain-language condition, and selector chips', () => {
      render(<AlertRuleList />);

      expect(screen.getByText('High temperature')).toBeInTheDocument();
      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText(/value above 30/i)).toBeInTheDocument();
      expect(screen.getByText('temperature')).toBeInTheDocument();
    });

    it('should show a loading spinner while loading', () => {
      mockUseAlertRulesList.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      });

      const { container } = render(<AlertRuleList />);

      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('should show an error message when the query fails', () => {
      mockUseAlertRulesList.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('network down'),
        refetch: mockRefetch,
      });

      render(<AlertRuleList />);

      expect(screen.getByText(/failed to load alert rules/i)).toBeInTheDocument();
    });

    it('should show "No alert rules." when the list is empty', () => {
      mockUseAlertRulesList.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertRuleList />);

      expect(screen.getByText(/no alert rules/i)).toBeInTheDocument();
    });
  });

  // --- The three useAdminAction() branches --------------------------------

  describe('admin gating on the enabled toggle and delete button (via useAdminAction)', () => {
    it('should render the toggle and delete control ENABLED for an admin, with no tooltip', () => {
      signedInAs('org:admin');

      render(<AlertRuleList />);

      const toggle = screen.getByRole('checkbox', { name: /disable high temperature/i });
      const del = screen.getByRole('button', { name: /delete high temperature/i });

      expect(toggle).not.toBeDisabled();
      expect(toggle).not.toHaveAttribute('title');
      expect(del).not.toBeDisabled();
      expect(del).not.toHaveAttribute('title');
    });

    it('should render the toggle and delete control PRESENT but DISABLED with a tooltip for a non-admin in demo mode', () => {
      signedInAs('org:member');
      setDemoMode('true');

      render(<AlertRuleList />);

      const toggle = screen.getByRole('checkbox', { name: /disable high temperature/i });
      const del = screen.getByRole('button', { name: /delete high temperature/i });

      expect(toggle).toBeInTheDocument();
      expect(toggle).toBeDisabled();
      expect(toggle).toHaveAttribute('title', expect.stringMatching(/admin/i));

      expect(del).toBeInTheDocument();
      expect(del).toBeDisabled();
      expect(del).toHaveAttribute('title', expect.stringMatching(/admin/i));
    });

    it('should HIDE the toggle and delete control entirely for a non-admin outside demo mode', () => {
      signedInAs('org:member');
      setDemoMode(undefined);

      render(<AlertRuleList />);

      expect(
        screen.queryByRole('checkbox', { name: /disable high temperature|enable high temperature/i })
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /delete high temperature/i })).not.toBeInTheDocument();
    });
  });

  describe('toggling enabled', () => {
    it('should flip enabled and toast success on completion', () => {
      signedInAs('org:admin');

      render(<AlertRuleList />);
      fireEvent.click(screen.getByRole('checkbox', { name: /disable high temperature/i }));

      expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
      const [variables, options] = mockUpdateMutate.mock.calls[0];
      expect(variables).toEqual({ id: 'rule_1', data: { enabled: false } });

      options.onSuccess();
      expect(mockToastSuccess).toHaveBeenCalledWith('Rule disabled');
    });
  });

  describe('delete confirmation', () => {
    it('should never call window.confirm, and should not call delete until the dialog is confirmed', () => {
      signedInAs('org:admin');
      const confirmSpy = jest.spyOn(window, 'confirm');

      render(<AlertRuleList />);
      fireEvent.click(screen.getByRole('button', { name: /delete high temperature/i }));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(mockDeleteMutate).not.toHaveBeenCalled();

      // The dialog's own confirm action has the exact accessible name "Delete"
      // (the per-row trigger's name is "Delete High temperature", so this is unambiguous).
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

      expect(mockDeleteMutate).toHaveBeenCalledTimes(1);
      const [id, options] = mockDeleteMutate.mock.calls[0];
      expect(id).toBe('rule_1');

      act(() => options.onSuccess());
      expect(mockToastSuccess).toHaveBeenCalledWith('Alert rule deleted');

      confirmSpy.mockRestore();
    });

    it('should not call delete when the confirmation is cancelled', () => {
      signedInAs('org:admin');

      render(<AlertRuleList />);
      fireEvent.click(screen.getByRole('button', { name: /delete high temperature/i }));
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(mockDeleteMutate).not.toHaveBeenCalled();
    });
  });
});
