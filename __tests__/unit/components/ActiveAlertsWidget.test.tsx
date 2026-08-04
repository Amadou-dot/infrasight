/**
 * ActiveAlertsWidget Tests
 *
 * `@/lib/query/hooks` is mocked at the exact module specifier
 * ActiveAlertsWidget.tsx imports from (matching the working pattern in
 * AlertList.test.tsx / DashboardStatCards.test.tsx), so the mock actually
 * intercepts the import the widget uses rather than a barrel re-export that
 * never gets hit.
 *
 * Loading / empty / error are asserted as mutually exclusive: each state's
 * test also asserts the OTHER states' text is absent. This guards against the
 * failure mode called out in the task brief — a component whose empty and
 * error branches both fall through to the same "nothing to show" output,
 * which would let a naive test (asserting only the positive case) pass while
 * the error state is invisible to an operator. Deletion-check evidence
 * proving these actually catch that regression is recorded in the task
 * report.
 */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActiveAlertsWidget } from '@/components/dashboard/ActiveAlertsWidget';
import { useAlertsList } from '@/lib/query/hooks';
import type { AlertV2Response } from '@/types/v2';

jest.mock('@/lib/query/hooks', () => ({
  useAlertsList: jest.fn(),
}));

const mockUseAlertsList = useAlertsList as jest.Mock;

function makeAlert(overrides: Partial<AlertV2Response> = {}): AlertV2Response {
  return {
    _id: 'a1',
    rule_id: 'rule_1',
    rule_name: 'High temp',
    device_id: 'device_001',
    status: 'firing',
    is_open: true,
    severity: 'critical',
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    trigger_value: 42,
    last_value: 42,
    breached_since: '2026-08-01T11:55:00.000Z',
    last_observed_at: '2026-08-01T12:00:00.000Z',
    fired_at: '2026-08-01T12:00:00.000Z',
    audit: {
      created_at: '2026-08-01T11:55:00.000Z',
      created_by: 'system',
      updated_at: '2026-08-01T12:00:00.000Z',
      updated_by: 'system',
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Fixed 5 minutes after the default fixture's fired_at, so relative-time
  // assertions are deterministic.
  jest.setSystemTime(new Date('2026-08-01T12:05:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ActiveAlertsWidget', () => {
  it('should show a loading state', () => {
    mockUseAlertsList.mockReturnValue({ data: undefined, isLoading: true, error: null });

    const { container } = render(<ActiveAlertsWidget />);

    expect(container.querySelector('.animate-pulse, .animate-spin')).not.toBeNull();
    // Loading must not also present as empty or errored.
    expect(screen.queryByText(/no active alerts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
  });

  it('should request the 5 highest-severity open alerts', () => {
    mockUseAlertsList.mockReturnValue({ data: [], isLoading: false, error: null });

    render(<ActiveAlertsWidget />);

    // Task 12 made severity sort rank-based (critical first) rather than
    // lexical. The widget must actually ask for that sort to benefit from it.
    expect(mockUseAlertsList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, sortBy: 'severity', sortDirection: 'desc' })
    );
  });

  it('should show an all-clear state when nothing is open', () => {
    mockUseAlertsList.mockReturnValue({ data: [], isLoading: false, error: null });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText(/no active alerts/i)).toBeInTheDocument();
    // Distinct from the error branch — not a shared fallback.
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
  });

  it('should render alert rows with status, severity, device id, and time since fired', () => {
    mockUseAlertsList.mockReturnValue({
      data: [makeAlert()],
      isLoading: false,
      error: null,
    });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText('High temp')).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
    expect(screen.getByText(/firing/i)).toBeInTheDocument();
    expect(screen.getByText('device_001')).toBeInTheDocument();
    // fired_at is 12:00:00.000Z, fixed "now" is 12:05:00.000Z.
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
  });

  it('should preserve server-provided order (critical first) rather than re-sorting client-side', () => {
    mockUseAlertsList.mockReturnValue({
      data: [
        makeAlert({ _id: 'a1', rule_name: 'Critical rule', severity: 'critical' }),
        makeAlert({ _id: 'a2', rule_name: 'Info rule', severity: 'info' }),
      ],
      isLoading: false,
      error: null,
    });

    render(<ActiveAlertsWidget />);

    const rows = screen
      .getAllByRole('link')
      .filter(el => /^\/alerts\//.test(el.getAttribute('href') ?? ''));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Critical rule');
    expect(rows[1]).toHaveTextContent('Info rule');
  });

  it('should link each row to its alert page', () => {
    mockUseAlertsList.mockReturnValue({
      data: [makeAlert()],
      isLoading: false,
      error: null,
    });

    render(<ActiveAlertsWidget />);

    expect(screen.getByRole('link', { name: /high temp/i })).toHaveAttribute('href', '/alerts/a1');
  });

  it('should link "View all alerts" to /alerts', () => {
    mockUseAlertsList.mockReturnValue({ data: [], isLoading: false, error: null });

    render(<ActiveAlertsWidget />);

    expect(screen.getByRole('link', { name: /view all alerts/i })).toHaveAttribute(
      'href',
      '/alerts'
    );
  });

  it('should show an error state', () => {
    mockUseAlertsList.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    });

    render(<ActiveAlertsWidget />);

    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    // Distinct from the empty branch — not a shared fallback.
    expect(screen.queryByText(/no active alerts/i)).not.toBeInTheDocument();
  });
});
