import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import MaintenanceForecastWidget from '@/components/MaintenanceForecastWidget';
import TemperatureCorrelationPanel from '@/components/TemperatureCorrelationPanel';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: { analytics: { maintenanceForecast: jest.fn(), temperatureCorrelation: jest.fn() } },
}));

const forecastRequest = v2Api.analytics.maintenanceForecast as jest.Mock;
const temperatureRequest = v2Api.analytics.temperatureCorrelation as jest.Mock;
const forecast = {
  critical: [],
  warning: [],
  watch: [],
  summary: {
    total_at_risk: 0,
    critical_count: 0,
    warning_count: 0,
    watch_count: 0,
    avg_battery_all: null,
    maintenance_overdue: [],
  },
  filters_applied: { days_ahead: 7, building_id: null, floor: null },
};

describe('analytics request lifecycle', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('shows initial forecast loading, then retries an error with a loading state', async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveRetry!: (value: unknown) => void;
    forecastRequest
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveRetry = resolve;
          })
      );
    const { container } = render(<MaintenanceForecastWidget />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();

    await act(async () => {
      rejectFirst(new Error('Forecast unavailable'));
    });
    expect(screen.getByText('Forecast unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('Forecast unavailable')).not.toBeInTheDocument();

    await act(async () => {
      resolveRetry({ data: forecast });
    });
    expect(screen.getByText('0 at risk')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  it('refreshes the forecast every minute without hiding loaded content and clears the timer on unmount', async () => {
    jest.useFakeTimers();
    let resolveRefresh!: (value: unknown) => void;
    forecastRequest.mockResolvedValueOnce({ data: forecast }).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRefresh = resolve;
        })
    );
    const { container, unmount } = render(<MaintenanceForecastWidget />);
    await act(async () => {});
    expect(screen.getByText('0 at risk')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(60000);
    });
    expect(forecastRequest).toHaveBeenCalledTimes(2);
    expect(screen.getByText('0 at risk')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();

    await act(async () => {
      resolveRefresh({ data: { ...forecast, summary: { ...forecast.summary, total_at_risk: 2 } } });
    });
    expect(screen.getByText('2 at risk')).toBeInTheDocument();
    unmount();
    act(() => {
      jest.advanceTimersByTime(60000);
    });
    expect(forecastRequest).toHaveBeenCalledTimes(2);
  });

  it('clears an old forecast error before committing a new forecast range', async () => {
    forecastRequest
      .mockRejectedValueOnce(new Error('Old forecast failed'))
      .mockImplementationOnce(() => new Promise(() => {}));
    const committedErrors: boolean[] = [];
    function Forecast({ days }: { days: number }) {
      useLayoutEffect(() => {
        if (days === 14) committedErrors.push(Boolean(screen.queryByText('Old forecast failed')));
      }, [days]);
      return <MaintenanceForecastWidget daysAhead={days} />;
    }
    const { rerender, container } = render(<Forecast days={7} />);
    await screen.findByText('Old forecast failed');
    rerender(<Forecast days={14} />);

    expect(committedErrors).toEqual([false]);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(forecastRequest).toHaveBeenLastCalledWith({ days_ahead: 14 });
  });

  it('clears the previous temperature error before committing another device', async () => {
    temperatureRequest
      .mockRejectedValueOnce(new Error('Old device failed'))
      .mockImplementationOnce(() => new Promise(() => {}));
    const committedErrors: boolean[] = [];
    function Temperature({ id }: { id: string }) {
      useLayoutEffect(() => {
        if (id === 'device_new')
          committedErrors.push(Boolean(screen.queryByText('Old device failed')));
      }, [id]);
      return <TemperatureCorrelationPanel deviceId={id} />;
    }
    const { rerender, container } = render(<Temperature id="device_old" />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    await screen.findByText('Old device failed');
    rerender(<Temperature id="device_new" />);

    expect(committedErrors).toEqual([false]);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(temperatureRequest).toHaveBeenLastCalledWith({ device_id: 'device_new' });
  });

  it('retries temperature failures and shows loading until the retry settles', async () => {
    let rejectRetry!: (error: Error) => void;
    temperatureRequest.mockRejectedValueOnce(new Error('First failure')).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRetry = reject;
        })
    );
    const { container } = render(<TemperatureCorrelationPanel deviceId="device_001" />);
    await screen.findByText('First failure');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('First failure')).not.toBeInTheDocument();
    await act(async () => {
      rejectRetry(new Error('Second failure'));
    });
    await waitFor(() => expect(screen.getByText('Second failure')).toBeInTheDocument());
  });
});
