/**
 * @jest-environment jsdom
 */

/**
 * Dashboard Stat Card Tests
 *
 * The dashboard used to hardcode its energy total ("4.2 MWh") and all four trend deltas,
 * so every arrow was fiction and never moved. These tests pin that the energy card is
 * derived from the API, and that cards with no historical series show no trend at all
 * rather than an invented one.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Home from '@/app/page';

const mockUseEnergyAnalytics = jest.fn();
const mockUseHealthAnalytics = jest.fn();

jest.mock('@/lib/query/hooks', () => ({
  useEnergyAnalytics: (...args: unknown[]) => mockUseEnergyAnalytics(...args),
  useHealthAnalytics: (...args: unknown[]) => mockUseHealthAnalytics(...args),
  useMaintenanceForecast: () => ({ data: { summary: { maintenance_overdue: [] } } }),
  useAnomalies: () => ({ data: [] }),
}));

jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ user: { firstName: 'Sam' } }),
}));

jest.mock('@/lib/auth/rbac-client', () => ({
  useAdminAction: () => ({ visible: false, disabled: true }),
}));

// Child widgets each fetch their own data; they are not what these tests are about.
jest.mock('@/components/DeviceDetailModal', () => () => null);
jest.mock('@/components/GenerateReportModal', () => () => null);
jest.mock('@/components/dashboard', () => {
  const Actual = jest.requireActual('@/components/dashboard');
  return {
    ...Actual,
    AnomalyDetectionChart: () => null,
    CriticalIssuesPanel: () => null,
    MaintenanceWidget: () => null,
    SystemHealthWidget: () => null,
  };
});

/** Locate a stat card by its title so we can assert on that card alone. */
function statCard(title: string): HTMLElement {
  const card = screen.getByText(title).closest('div[class*="bg-card"]');
  if (!card) throw new Error(`No stat card found for "${title}"`);
  return card as HTMLElement;
}

function energyResponse(currentTotal: number, percentageChange: number | null) {
  return {
    data: {
      comparison: {
        summary: {
          current_total: currentTotal,
          comparison_total: 0,
          percentage_change: percentageChange,
          trend: percentageChange === null ? 'no_data' : 'increase',
        },
      },
    },
    isLoading: false,
  };
}

describe('Dashboard stat cards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseHealthAnalytics.mockReturnValue({
      data: {
        summary: { total_devices: 500, health_score: 87 },
        alerts: {
          offline_devices: { count: 3 },
          error_devices: { count: 1 },
          low_battery_devices: { count: 2 },
        },
      },
      isLoading: false,
    });
    mockUseEnergyAnalytics.mockReturnValue(energyResponse(29723.38, 11.27));
  });

  it('should show the energy total from the API, formatted', () => {
    render(<Home />);

    expect(screen.getByText('29.7 MWh')).toBeInTheDocument();
    expect(screen.queryByText('4.2 MWh')).not.toBeInTheDocument();
  });

  it('should request a summed energy total with a comparison period', () => {
    render(<Home />);

    expect(mockUseEnergyAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'energy',
        aggregation: 'sum',
        compare_with: 'previous_period',
      })
    );
  });

  it('should show rising consumption as an increase, coloured as bad news', () => {
    render(<Home />);
    const card = statCard('Energy Usage');

    expect(card).toHaveTextContent('+11.3%');
    expect(card).toHaveTextContent('↗');
    expect(card.querySelector('.bg-red-500\\/10')).toBeInTheDocument();
  });

  it('should colour falling consumption as good news', () => {
    mockUseEnergyAnalytics.mockReturnValue(energyResponse(21000, -8.4));

    render(<Home />);
    const card = statCard('Energy Usage');

    expect(card).toHaveTextContent('-8.4%');
    expect(card.querySelector('.bg-green-500\\/10')).toBeInTheDocument();
  });

  it.each(['Total Devices', 'Active Alerts', 'Efficiency Score'])(
    'should show no trend on %s, which has no historical series',
    title => {
      render(<Home />);
      const card = statCard(title);

      expect(card.querySelector('.bg-green-500\\/10')).not.toBeInTheDocument();
      expect(card.querySelector('.bg-red-500\\/10')).not.toBeInTheDocument();
    }
  );

  it('should omit the energy trend when the API reports no comparison data', () => {
    mockUseEnergyAnalytics.mockReturnValue(energyResponse(0, null));

    render(<Home />);
    const card = statCard('Energy Usage');

    expect(card.querySelector('.bg-green-500\\/10')).not.toBeInTheDocument();
    expect(card.querySelector('.bg-red-500\\/10')).not.toBeInTheDocument();
  });

  it('should show a placeholder rather than NaN when energy data is missing', () => {
    mockUseEnergyAnalytics.mockReturnValue({ data: undefined, isLoading: false });

    render(<Home />);

    expect(statCard('Energy Usage')).toHaveTextContent('—');
  });
});
