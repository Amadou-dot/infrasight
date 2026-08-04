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
 * `@/lib/query/hooks` (useAlertDetail), `next/navigation`
 * (useParams/notFound), and `@tanstack/react-query` (useQuery, for the
 * bracketing-readings query) are all mocked so the page's own
 * loading/error/notFound orchestration can be exercised without a real
 * QueryClientProvider or network. `AlertDetailView` is mocked to a stub so
 * this file stays scoped to the page's own logic — AlertDetailView.test.tsx
 * already covers the presentational component in depth.
 */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
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

// The page's own inline useQuery (for bracketing readings) needs no
// QueryClientProvider once mocked — its wiring isn't this file's concern.
// requireActual keeps the real QueryClient class intact: lib/query/queryClient.ts
// (imported transitively for queryKeys) instantiates one at module load time.
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: () => ({ data: [], isLoading: false }),
}));

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

beforeEach(() => {
  jest.clearAllMocks();
  mockUseParams.mockReturnValue({ id: 'alert_1' });
});

describe('AlertDetailPage', () => {
  it('should show a loading spinner while the alert is loading, and not render the view or 404', () => {
    mockUseAlertDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
    });

    const { container } = render(<AlertDetailPage />);

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-detail-view')).not.toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('should render the styled not-found state for an alert id that does not resolve (404)', () => {
    mockUseAlertDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiClientError(404, 'ALERT_NOT_FOUND', 'Alert not found'),
      refetch: jest.fn(),
    });

    render(<AlertDetailPage />);

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('should show a retry banner (not the 404 page) for a non-404 error', () => {
    mockUseAlertDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiClientError(500, 'NETWORK_ERROR', 'Network error occurred'),
      refetch: jest.fn(),
    });

    render(<AlertDetailPage />);

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

    render(<AlertDetailPage />);

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

    render(<AlertDetailPage />);

    const [, , config] = mockUseAlertDetail.mock.calls[0];
    expect(config).toMatchObject({ retry: false });
  });
});
