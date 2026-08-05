/**
 * AlertDetailView Tests
 *
 * `@/lib/query/hooks` is mocked at the exact module specifier AlertDetailView.tsx
 * imports from (useAcknowledgeAlert/useResolveAlert), because the component calls
 * those mutation hooks directly (mirroring AlertList.tsx's self-contained
 * pattern) and rendering a real useMutation() with no QueryClientProvider in
 * scope throws.
 *
 * `useAdminAction`/`useRbac` (lib/auth/rbac-client.tsx) are deliberately NOT
 * mocked — only their dependency on Clerk's `useAuth` is stubbed, exactly like
 * __tests__/unit/components/AlertList.test.tsx does. That exercises the real
 * useAdminAction() gating contract end to end instead of only proving the
 * component reads a mocked return value correctly (the class of bug Task 15's
 * review flagged: hand-rolled gating that bypassed useAdminAction entirely).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AlertDetailView } from '@/components/alerts/AlertDetailView';
import type { AlertV2Response } from '@/types/v2';

const mockAcknowledgeMutate = jest.fn();
const mockResolveMutate = jest.fn();
let acknowledgeIsPending = false;
let resolveIsPending = false;

jest.mock('@/lib/query/hooks', () => ({
  useAcknowledgeAlert: () => ({ mutate: mockAcknowledgeMutate, isPending: acknowledgeIsPending }),
  useResolveAlert: () => ({ mutate: mockResolveMutate, isPending: resolveIsPending }),
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

function alert(overrides: Partial<AlertV2Response> = {}): AlertV2Response {
  return {
    _id: '507f1f77bcf86cd799439011',
    rule_id: '507f1f77bcf86cd799439012',
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

beforeEach(() => {
  jest.clearAllMocks();
  acknowledgeIsPending = false;
  resolveIsPending = false;
  setDemoMode(undefined);
  // Most tests below don't care about role; default to admin so
  // Acknowledge/Resolve are visible+enabled unless a test says otherwise.
  signedInAs('org:admin');
});

afterEach(() => {
  setDemoMode(ORIGINAL_DEMO_MODE as 'true' | undefined);
});

describe('AlertDetailView', () => {
  it('should state the condition in plain language', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByText(/above 30/i)).toBeInTheDocument();
  });

  it('should mention the duration when the rule has one', () => {
    render(
      <AlertDetailView
        alert={alert()}
        bracketingReadings={[]}
        loading={false}
        forDurationSeconds={300}
      />
    );

    expect(screen.getByText(/for 5 minutes/i)).toBeInTheDocument();
  });

  it('should render the lifecycle timeline', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByText(/breached since/i)).toBeInTheDocument();
    expect(screen.getByText(/fired/i)).toBeInTheDocument();
  });

  it('should show acknowledged and resolved steps once they exist', () => {
    render(
      <AlertDetailView
        alert={alert({
          status: 'resolved',
          is_open: false,
          audit: {
            created_at: '2026-08-01T12:00:00.000Z',
            created_by: 'system',
            updated_at: '2026-08-01T12:40:00.000Z',
            updated_by: 'user_1',
            acknowledged_at: '2026-08-01T12:20:00.000Z',
            acknowledged_by: 'user_1',
            resolved_at: '2026-08-01T12:40:00.000Z',
            resolved_by: 'user_1',
            resolution: 'manual',
          },
        })}
        bracketingReadings={[]}
        loading={false}
      />
    );

    expect(screen.getByText(/acknowledged/i)).toBeInTheDocument();
    // D4 fix: this used to assert /resolved/i, which is satisfied by the
    // status badge alone (AlertStatusBadge renders the literal text
    // "Resolved") and says nothing about the timeline's own closing step —
    // RESOLUTION_LABELS deliberately avoids the word "resolved" so the two
    // don't collide. Asserting the real label text ("closed manually", from
    // RESOLUTION_LABELS.manual) is the only way this test can actually fail
    // if the resolved timeline block is deleted; see the task report for the
    // deletion-check evidence.
    expect(screen.getByText(/closed manually/i)).toBeInTheDocument();
  });

  it('should link to the device', () => {
    render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

    expect(screen.getByRole('link', { name: /device_001/i })).toHaveAttribute(
      'href',
      '/devices/device_001'
    );
  });

  it('should render the bracketing readings', () => {
    render(
      <AlertDetailView
        alert={alert()}
        bracketingReadings={[
          { timestamp: '2026-08-01T12:04:00.000Z', value: 29 },
          { timestamp: '2026-08-01T12:05:00.000Z', value: 42 },
        ]}
        loading={false}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
  });

  // --- Additional coverage beyond the brief's literal 6 tests -------------

  describe('resolution wording (auto vs stale/device_inactive)', () => {
    it('should describe an automatic resolution distinctly from a stale/inactive closure', () => {
      const resolvedAudit = {
        created_at: '2026-08-01T12:00:00.000Z',
        created_by: 'system',
        updated_at: '2026-08-01T12:40:00.000Z',
        updated_by: 'system',
        resolved_at: '2026-08-01T12:40:00.000Z',
        resolved_by: 'system',
      };

      const { rerender } = render(
        <AlertDetailView
          alert={alert({
            status: 'resolved',
            is_open: false,
            audit: { ...resolvedAudit, resolution: 'auto' },
          })}
          bracketingReadings={[]}
          loading={false}
        />
      );
      expect(screen.getByText(/back within threshold/i)).toBeInTheDocument();

      rerender(
        <AlertDetailView
          alert={alert({
            status: 'resolved',
            is_open: false,
            audit: { ...resolvedAudit, resolution: 'stale' },
          })}
          bracketingReadings={[]}
          loading={false}
        />
      );
      expect(screen.getByText(/stale/i)).toBeInTheDocument();
      expect(screen.queryByText(/back within threshold/i)).not.toBeInTheDocument();

      rerender(
        <AlertDetailView
          alert={alert({
            status: 'resolved',
            is_open: false,
            audit: { ...resolvedAudit, resolution: 'device_inactive' },
          })}
          bracketingReadings={[]}
          loading={false}
        />
      );
      expect(screen.getByText(/device went inactive/i)).toBeInTheDocument();
    });
  });

  describe('actors on the timeline', () => {
    it('should show the actor beside both the acknowledged and closed steps', () => {
      render(
        <AlertDetailView
          alert={alert({
            status: 'resolved',
            is_open: false,
            audit: {
              created_at: '2026-08-01T12:00:00.000Z',
              created_by: 'system',
              updated_at: '2026-08-01T12:40:00.000Z',
              updated_by: 'alice',
              acknowledged_at: '2026-08-01T12:20:00.000Z',
              acknowledged_by: 'alice',
              resolved_at: '2026-08-01T12:40:00.000Z',
              resolved_by: 'bob',
              resolution: 'manual',
            },
          })}
          bracketingReadings={[]}
          loading={false}
        />
      );

      expect(screen.getByText(/acknowledged.*alice/i)).toBeInTheDocument();
      expect(screen.getByText(/bob/i)).toBeInTheDocument();
    });
  });

  describe('resolved_value is conditional', () => {
    it('should not render a closing value when resolved_value is absent (manual/swept resolution)', () => {
      render(
        <AlertDetailView
          alert={alert({
            status: 'resolved',
            is_open: false,
            resolved_value: undefined,
          })}
          bracketingReadings={[]}
          loading={false}
        />
      );

      expect(screen.queryByText(/closing value/i)).not.toBeInTheDocument();
    });

    it('should render the closing value when auto-resolution attributes one', () => {
      render(
        <AlertDetailView
          alert={alert({
            status: 'resolved',
            is_open: false,
            resolved_value: 24,
          })}
          bracketingReadings={[]}
          loading={false}
        />
      );

      expect(screen.getByText(/closing value: 24/i)).toBeInTheDocument();
    });
  });

  describe('bracketing readings loading state', () => {
    it('should show a loading indicator for the readings table while it loads', () => {
      const { container } = render(
        <AlertDetailView alert={alert()} bracketingReadings={[]} loading />
      );

      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
      expect(screen.queryByText(/no readings in this window/i)).not.toBeInTheDocument();
    });

    it('should show an empty state once loaded with no bracketing readings', () => {
      const { container } = render(
        <AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />
      );

      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
      expect(screen.getByText(/no readings in this window/i)).toBeInTheDocument();
      // Distinct from the error branch (A3) — not a shared fallback.
      expect(screen.queryByText(/failed to load readings/i)).not.toBeInTheDocument();
    });
  });

  // --- A3: a failed readings fetch must render a state visually distinct
  // from "No readings in this window." (the signature of a genuinely empty,
  // successful response) — the two must never collapse into the same output.
  describe('bracketing readings error state (A3)', () => {
    it('should render a distinct error state instead of the empty-state copy when the readings query fails', () => {
      render(
        <AlertDetailView
          alert={alert()}
          bracketingReadings={[]}
          loading={false}
          readingsError={new Error('network down')}
        />
      );

      expect(screen.getByText(/failed to load readings/i)).toBeInTheDocument();
      // The empty-state copy reads as "stale/device_inactive" (see the
      // component's own RESOLUTION_LABELS doc comment) — the wrong
      // diagnosis for a fetch that never actually completed.
      expect(screen.queryByText(/no readings in this window/i)).not.toBeInTheDocument();
    });

    it('should offer a retry affordance in the error state, and call it when clicked', () => {
      const onRetryReadings = jest.fn();

      render(
        <AlertDetailView
          alert={alert()}
          bracketingReadings={[]}
          loading={false}
          readingsError={new Error('network down')}
          onRetryReadings={onRetryReadings}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /retry/i }));

      expect(onRetryReadings).toHaveBeenCalledTimes(1);
    });

    it('should prioritize the loading spinner over the error state while still loading', () => {
      const { container } = render(
        <AlertDetailView
          alert={alert()}
          bracketingReadings={[]}
          loading
          readingsError={new Error('network down')}
        />
      );

      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
      expect(screen.queryByText(/failed to load readings/i)).not.toBeInTheDocument();
    });

    it('should not render a retry button when no retry callback is provided', () => {
      render(
        <AlertDetailView
          alert={alert()}
          bracketingReadings={[]}
          loading={false}
          readingsError={new Error('network down')}
        />
      );

      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });
  });

  // --- The three useAdminAction() branches, and the button visibility rules -

  describe('admin gating on Acknowledge/Resolve (via useAdminAction)', () => {
    it('should render Acknowledge and Resolve ENABLED for an admin, with no tooltip', () => {
      signedInAs('org:admin');

      render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

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

      render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

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

      render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);

      expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
    });

    it('should not render Acknowledge for an alert that is not firing, regardless of role', () => {
      signedInAs('org:admin');

      render(
        <AlertDetailView
          alert={alert({ status: 'acknowledged', is_open: true })}
          bracketingReadings={[]}
          loading={false}
        />
      );

      expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
    });

    it('should not render Resolve for an alert that is already resolved (not open)', () => {
      signedInAs('org:admin');

      render(
        <AlertDetailView
          alert={alert({ status: 'resolved', is_open: false })}
          bracketingReadings={[]}
          loading={false}
        />
      );

      expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
    });
  });

  describe('admin actions', () => {
    it('should acknowledge with the alert id and toast success on completion', () => {
      signedInAs('org:admin');

      render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);
      fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));

      expect(mockAcknowledgeMutate).toHaveBeenCalledTimes(1);
      const [variables, options] = mockAcknowledgeMutate.mock.calls[0];
      expect(variables).toEqual({ id: '507f1f77bcf86cd799439011' });

      options.onSuccess();
      expect(mockToastSuccess).toHaveBeenCalledWith('Alert acknowledged');

      options.onError(new Error('boom'));
      expect(mockToastError).toHaveBeenCalledWith('boom');
    });

    it('should resolve with the alert id and toast success on completion', () => {
      signedInAs('org:admin');

      render(<AlertDetailView alert={alert()} bracketingReadings={[]} loading={false} />);
      fireEvent.click(screen.getByRole('button', { name: /resolve/i }));

      expect(mockResolveMutate).toHaveBeenCalledTimes(1);
      const [variables, options] = mockResolveMutate.mock.calls[0];
      expect(variables).toEqual({ id: '507f1f77bcf86cd799439011' });

      options.onSuccess();
      expect(mockToastSuccess).toHaveBeenCalledWith('Alert resolved');
    });
  });
});
