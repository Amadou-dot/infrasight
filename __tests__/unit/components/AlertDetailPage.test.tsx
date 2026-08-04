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
jest.mock('@/lib/query/hooks', () => ({
  useAlertDetail: (...args: unknown[]) => mockUseAlertDetail(...args),
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

jest.mock('@/components/alerts/AlertDetailView', () => ({
  AlertDetailView: (props: ComponentProps<typeof AlertDetailViewType>) => (
    <div data-testid="alert-detail-view">{props.alert.rule_name}</div>
  ),
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
});
