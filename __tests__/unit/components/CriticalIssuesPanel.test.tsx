import { render, screen } from '@testing-library/react';
import CriticalIssuesPanel from '@/components/dashboard/CriticalIssuesPanel';

const mockHealth = jest.fn();
const mockForecast = jest.fn();
jest.mock('@/lib/query/hooks', () => ({
  useHealthAnalytics: () => mockHealth(),
  useMaintenanceForecast: () => mockForecast(),
}));

function healthWith(alerts: Record<string, unknown>) {
  return { data: { alerts }, isLoading: false, error: null };
}

describe('CriticalIssuesPanel timestamps', () => {
  beforeEach(() => {
    mockForecast.mockReturnValue({ data: { summary: { maintenance_overdue: [] }, critical: [] }, isLoading: false, error: null });
  });

  it('shows no relative time for issues the server sends no timestamp for', () => {
    mockHealth.mockReturnValue(
      healthWith({
        error_devices: { count: 1, devices: [{ _id: 'device_009', serial_number: 'SN-1009', location: { room_name: 'Lab' } }] },
      })
    );
    render(<CriticalIssuesPanel />);
    expect(screen.getByText(/Error/)).toBeInTheDocument();
    expect(screen.queryByText(/ago|Just now/i)).not.toBeInTheDocument();
  });

  it('still shows a relative time when the server provides one', () => {
    mockHealth.mockReturnValue(
      healthWith({
        offline_devices: {
          count: 1,
          devices: [{ _id: 'device_010', serial_number: 'SN-1010', location: { room_name: 'Roof', floor: 3 }, health: { last_seen: new Date(Date.now() - 5 * 60_000).toISOString() } }],
        },
      })
    );
    render(<CriticalIssuesPanel />);
    expect(screen.getByText(/ago|Just now/i)).toBeInTheDocument();
  });
});
