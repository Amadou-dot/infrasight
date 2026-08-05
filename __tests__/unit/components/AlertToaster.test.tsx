/**
 * AlertToaster Tests
 *
 * AlertToaster's entire job is deciding which alert envelopes become popups
 * and which reconcile silently. `usePusherAlerts`, `react-toastify`, and
 * `next/navigation` are all mocked so a test can hand the component an
 * envelope directly and inspect exactly what it did with it.
 *
 * The two "storm"/"resolved" rows are the point of this file: a suite that
 * only checks the positive (toast-raising) cases would pass just as happily
 * against a component that toasts unconditionally. See the deletion-check
 * evidence in the task report for proof these fail when the `of === 'fired'`
 * guard is removed.
 */

import { render, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { usePusherAlerts } from '@/lib/pusher-context';
import { AlertToaster } from '@/components/alerts/AlertToaster';
import { queryKeys } from '@/lib/query/queryClient';
import type { AlertEvent, FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('react-toastify', () => ({
  toast: {
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('@/lib/pusher-context', () => ({
  usePusherAlerts: jest.fn(),
}));

function fired(overrides: Partial<FiredAlert> = {}): FiredAlert {
  return {
    _id: 'alert_1',
    rule_id: 'rule_1',
    rule_name: 'High temp',
    device_id: 'device_001',
    severity: 'critical',
    metric: 'value',
    comparison: 'gt',
    threshold: 30,
    trigger_value: 35,
    fired_at: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function resolvedAlert(overrides: Partial<ResolvedAlert> = {}): ResolvedAlert {
  return {
    _id: 'alert_1',
    rule_id: 'rule_1',
    device_id: 'device_001',
    severity: 'warning',
    resolution: 'auto',
    resolved_at: '2026-08-01T12:30:00.000Z',
    actor: 'system',
    ...overrides,
  };
}

/**
 * Renders AlertToaster under a real QueryClient (so useQueryClient() has
 * something to find) and returns a spy on invalidateQueries plus the handler
 * AlertToaster registered with the mocked usePusherAlerts — dispatching to
 * that handler is how each test hands the component an envelope directly.
 */
function renderToaster() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

  render(
    <QueryClientProvider client={queryClient}>
      <AlertToaster />
    </QueryClientProvider>
  );

  const handleEvent = (usePusherAlerts as jest.Mock).mock.calls.at(-1)?.[0] as (
    event: AlertEvent
  ) => void;

  return { invalidateSpy, handleEvent };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AlertToaster', () => {
  it('renders nothing', () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AlertToaster />
      </QueryClientProvider>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('registers exactly one alert-event handler via usePusherAlerts', () => {
    renderToaster();

    expect(usePusherAlerts).toHaveBeenCalledTimes(1);
    expect(typeof (usePusherAlerts as jest.Mock).mock.calls[0][0]).toBe('function');
  });

  it('toasts once per fired alert, mapped by severity, and invalidates the alerts cache', () => {
    const { invalidateSpy, handleEvent } = renderToaster();

    const event: AlertEvent = {
      kind: 'fired',
      alerts: [
        fired({ _id: 'a1', severity: 'critical', rule_name: 'High temp', device_id: 'device_001', trigger_value: 40 }),
        fired({ _id: 'a2', severity: 'info', rule_name: 'Low battery', device_id: 'device_002', trigger_value: 12 }),
      ],
    };
    act(() => handleEvent(event));

    // Severity maps to toast type: critical -> error, info -> info.
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('High temp'),
      expect.objectContaining({ onClick: expect.any(Function) })
    );
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('Low battery'),
      expect.anything()
    );
    expect(toast.warning).not.toHaveBeenCalled();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.alerts.all });
  });

  // Negative case #1: a resolved BATCH must never toast. Nobody wants a popup
  // per device when a floor-wide condition clears; the acting admin already
  // got feedback from their own mutation's optimistic update.
  it('does NOT toast for a resolved batch, but still invalidates the alerts cache', () => {
    const { invalidateSpy, handleEvent } = renderToaster();

    const event: AlertEvent = {
      kind: 'resolved',
      alerts: [resolvedAlert({ _id: 'a1' }), resolvedAlert({ _id: 'a2' })],
    };
    act(() => handleEvent(event));

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.alerts.all });
  });

  it('toasts once for a FIRED storm, mentioning the count, and invalidates', () => {
    const { invalidateSpy, handleEvent } = renderToaster();

    const event: AlertEvent = {
      kind: 'storm',
      of: 'fired',
      count: 312,
      by_severity: { info: 0, warning: 12, critical: 300 },
      since: '2026-08-01T12:00:00.000Z',
    };
    act(() => handleEvent(event));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('312'),
      expect.objectContaining({ onClick: expect.any(Function) })
    );
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.alerts.all });
  });

  // Negative case #2: the whole reason `of` exists. A resolved storm is a mass
  // RECOVERY (e.g. a floor-wide condition clearing) — announcing it with the
  // same red "N alerts firing" banner would report the best news in the app as
  // the worst. A suite that only asserts the fired-storm row above would pass
  // just as happily against a component that toasts on every storm.
  it('does NOT toast for a RESOLVED storm, but still invalidates', () => {
    const { invalidateSpy, handleEvent } = renderToaster();

    const event: AlertEvent = {
      kind: 'storm',
      of: 'resolved',
      count: 312,
      by_severity: { info: 0, warning: 12, critical: 300 },
      since: '2026-08-01T12:00:00.000Z',
    };
    act(() => handleEvent(event));

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.alerts.all });
  });
});

/**
 * Toast lifetime. These rows are about a config value whose meaning changed
 * underneath it: `autoClose={false}` was fine while every toast was raised by a
 * user, one at a time. Alerts come from a background evaluator that can emit up
 * to ALERT_EVENT_MAX (20) from one ingest, so a toast that never expires and
 * cannot be clicked away stacks past the top of the viewport and follows the
 * viewer across every route until they reload.
 *
 * Asserting `expect.any(Number)` is not enough on its own — `autoClose: false`
 * would fail that, but so would a `0`, which react-toastify treats as "never
 * close". Each row therefore checks the value is a positive finite number.
 */
describe('AlertToaster toast lifetime', () => {
  function optionsOf(mock: jest.Mock) {
    return mock.mock.calls.at(-1)?.[1] as {
      autoClose?: number | false;
      closeOnClick?: boolean;
      toastId?: string;
    };
  }

  it('gives every fired toast a finite dismissal, click-to-close, and a stable id', () => {
    const { handleEvent } = renderToaster();

    act(() =>
      handleEvent({
        kind: 'fired',
        alerts: [fired({ _id: 'alert_42', severity: 'critical' })],
      })
    );

    const options = optionsOf(toast.error as jest.Mock);
    expect(typeof options.autoClose).toBe('number');
    expect(options.autoClose).toBeGreaterThan(0);
    expect(Number.isFinite(options.autoClose as number)).toBe(true);
    expect(options.closeOnClick).toBe(true);
    expect(options.toastId).toBe('alert_42');
  });

  it('gives each severity a finite dismissal', () => {
    const { handleEvent } = renderToaster();

    act(() =>
      handleEvent({
        kind: 'fired',
        alerts: [
          fired({ _id: 'a_crit', severity: 'critical' }),
          fired({ _id: 'a_warn', severity: 'warning' }),
          fired({ _id: 'a_info', severity: 'info' }),
        ],
      })
    );

    for (const mock of [toast.error, toast.warning, toast.info] as jest.Mock[]) {
      const options = optionsOf(mock);
      expect(typeof options.autoClose).toBe('number');
      expect(options.autoClose).toBeGreaterThan(0);
      expect(options.closeOnClick).toBe(true);
    }
  });

  it('reuses the toastId when the same alert is re-broadcast, so it cannot stack', () => {
    const { handleEvent } = renderToaster();

    const event: AlertEvent = { kind: 'fired', alerts: [fired({ _id: 'alert_dupe' })] };
    act(() => handleEvent(event));
    act(() => handleEvent(event));

    const ids = (toast.error as jest.Mock).mock.calls.map(call => call[1]?.toastId);
    expect(ids).toEqual(['alert_dupe', 'alert_dupe']);
  });

  it('gives the storm toast a finite dismissal and click-to-close too', () => {
    const { handleEvent } = renderToaster();

    act(() =>
      handleEvent({
        kind: 'storm',
        of: 'fired',
        count: 312,
        by_severity: { info: 0, warning: 12, critical: 300 },
        since: '2026-08-01T12:00:00.000Z',
      })
    );

    const options = optionsOf(toast.error as jest.Mock);
    expect(typeof options.autoClose).toBe('number');
    expect(options.autoClose).toBeGreaterThan(0);
    expect(options.closeOnClick).toBe(true);
    // Distinct storms stay distinct; a re-broadcast of the same one does not stack.
    expect(options.toastId).toContain('2026-08-01T12:00:00.000Z');
  });
});
