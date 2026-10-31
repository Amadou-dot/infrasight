import React from 'react';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FloorPlan from '@/components/FloorPlan';
import FloorPlanPage from '@/app/floor-plan/page';
import { usePusherReadings, type PusherReading } from '@/lib/pusher-context';

jest.mock('@/lib/pusher-context', () => ({ usePusherReadings: jest.fn() }));
jest.mock('@/components/DeviceDetailModal', () => ({ __esModule: true, default: () => null }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), warning: jest.fn() } }));

const timestamp = '2026-10-31T10:00:00Z';
function device(id: string, building = 'Building-A') {
  return {
    _id: id,
    type: 'temperature',
    location: { building_id: building, floor: 0, room_name: id },
    configuration: {},
  };
}
function response(data: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => data } as Response;
}
function readings(value: number, id = 'device_001', time = timestamp) {
  return response({
    success: true,
    data: { readings: [{ device_id: id, value, timestamp: time, type: 'temperature' }] },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Floor Plan loading', () => {
  let client: QueryClient;
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  let rows = [device('device_001')];

  function deviceResponse(url: URL) {
    const filtered = rows.filter(
      row =>
        (!url.searchParams.has('building_id') ||
          row.location.building_id === url.searchParams.get('building_id')) &&
        (!url.searchParams.has('floor') ||
          row.location.floor === Number(url.searchParams.get('floor')))
    );
    const page = Number(url.searchParams.get('page') || 1);
    return response({
      success: true,
      data: filtered.slice((page - 1) * 100, page * 100),
      pagination: {
        totalPages: Math.ceil(filtered.length / 100),
        total: filtered.length,
        page,
        limit: 100,
      },
    });
  }
  const latestCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/readings/latest'));
  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  function push(value: number, time: string, id = 'device_001') {
    const calls = jest.mocked(usePusherReadings).mock.calls;
    const callback = calls[calls.length - 1][0];
    act(() =>
      callback([
        {
          metadata: { device_id: id, type: 'temperature' },
          value,
          timestamp: time,
        } as PusherReading,
      ])
    );
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    rows = [device('device_001')];
    fetchMock.mockReset().mockImplementation(async url => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/v2/devices') return deviceResponse(parsed);
      return readings(21);
    });
    global.fetch = fetchMock;
  });
  afterEach(() => {
    cleanup();
    client.clear();
  });

  it('requests only the selected building/floor and tile fields, including floor zero', async () => {
    render(<FloorPlan selectedBuilding="Building-A" selectedFloor={0} />, { wrapper });
    expect(await screen.findByText('21°F')).toBeInTheDocument();
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(url.searchParams.get('building_id')).toBe('Building-A');
    expect(url.searchParams.get('floor')).toBe('0');
    expect(url.searchParams.get('fields')?.split(',')).toEqual([
      '_id',
      'type',
      'location.building_id',
      'location.floor',
      'location.room_name',
      'configuration.threshold_warning',
      'configuration.threshold_critical',
    ]);
  });

  it('shows a completed reading batch while a slower batch is still pending', async () => {
    rows = Array.from({ length: 51 }, (_, i) => device(`device_${String(i).padStart(3, '0')}`));
    const slow = deferred<Response>();
    fetchMock.mockImplementation(async url => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/v2/devices') return deviceResponse(parsed);
      return parsed.searchParams.getAll('device_ids').includes('device_050')
        ? slow.promise
        : readings(21, 'device_000');
    });
    render(<FloorPlan selectedBuilding="Building-A" selectedFloor="all" />, { wrapper });
    expect(await screen.findByText('21°F')).toBeInTheDocument();
    expect(screen.queryByText('22°F')).not.toBeInTheDocument();
    await act(async () => slow.resolve(readings(22, 'device_050')));
    expect(await screen.findByText('22°F')).toBeInTheDocument();
  });

  it('retains a completed snapshot across unmount and remount', async () => {
    const view = render(<FloorPlan selectedFloor="all" />, { wrapper });
    await screen.findByText('21°F');
    view.unmount();
    render(<FloorPlan selectedFloor="all" />, { wrapper });
    expect(screen.getByText('21°F')).toBeInTheDocument();
    expect(latestCalls()).toHaveLength(1);
  });

  it('keeps newer Pusher values when older HTTP and websocket responses arrive', async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementation(async url =>
      String(url).includes('/devices')
        ? deviceResponse(new URL(String(url), 'http://localhost'))
        : pending.promise
    );
    render(<FloorPlan selectedFloor="all" />, { wrapper });
    await waitFor(() => expect(latestCalls()).toHaveLength(1));
    push(40, '2026-10-31T10:00:10Z');
    expect(await screen.findByText('40°F')).toBeInTheDocument();
    await act(async () => pending.resolve(readings(21)));
    await waitFor(() => expect(screen.queryByText('Updating readings…')).not.toBeInTheDocument());
    push(30, '2026-10-31T10:00:05Z');
    expect(screen.getByText('40°F')).toBeInTheDocument();
  });

  it('shows partial failures and retries the missing readings', async () => {
    rows = Array.from({ length: 51 }, (_, i) => device(`device_${String(i).padStart(3, '0')}`));
    let fail = true;
    fetchMock.mockImplementation(async url => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/v2/devices') return deviceResponse(parsed);
      if (parsed.searchParams.getAll('device_ids').includes('device_050'))
        return fail
          ? response({ success: false, error: { message: 'Unavailable' } }, 503)
          : readings(22, 'device_050');
      return readings(21, 'device_000');
    });
    render(<FloorPlan selectedFloor="all" />, { wrapper });
    expect(await screen.findByText(/Some readings could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText('21°F')).toBeInTheDocument();
    push(40, '2026-10-31T10:00:10Z', 'device_000');
    expect(await screen.findByText('40°F')).toBeInTheDocument();
    expect(screen.getByText(/Some readings could not be loaded/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry readings' }));
    expect(await screen.findByText('22°F')).toBeInTheDocument();
    expect(screen.queryByText(/Some readings could not be loaded/)).not.toBeInTheDocument();
  });

  it('does not show stale devices or late readings after switching buildings', async () => {
    rows = [device('device_001'), device('device_002', 'Building-B')];
    const pending = deferred<Response>();
    fetchMock.mockImplementation(async url => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/v2/devices') return deviceResponse(parsed);
      return parsed.searchParams.getAll('device_ids').includes('device_001')
        ? pending.promise
        : readings(25, 'device_002');
    });
    const view = render(<FloorPlan selectedBuilding="Building-A" selectedFloor="all" />, {
      wrapper,
    });
    await waitFor(() => expect(latestCalls()).toHaveLength(1));
    view.rerender(<FloorPlan selectedBuilding="Building-B" selectedFloor="all" />);
    expect(await screen.findByText('25°F')).toBeInTheDocument();
    await act(async () => pending.resolve(readings(99)));
    expect(screen.queryByText('device_001')).not.toBeInTheDocument();
    expect(screen.queryByText('99°F')).not.toBeInTheDocument();
  });

  it('shows a device failure with retry rather than an empty result', async () => {
    fetchMock.mockResolvedValue(
      response({ success: false, error: { message: 'Unavailable' } }, 503)
    );
    render(<FloorPlan selectedFloor="all" />, { wrapper });
    expect(await screen.findByText(/Could not load devices/)).toBeInTheDocument();
    expect(screen.queryByText('No devices found.')).not.toBeInTheDocument();
    fetchMock.mockImplementation(async url =>
      String(url).includes('/devices')
        ? deviceResponse(new URL(String(url), 'http://localhost'))
        : readings(21)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry devices' }));
    expect(await screen.findByText('21°F')).toBeInTheDocument();
  });

  it.each(['building', 'floor'] as const)(
    'preserves the newest reading across overlapping %s selections',
    async scope => {
      const second = device('device_002', scope === 'building' ? 'Building-B' : 'Building-A');
      second.location.floor = 1;
      rows = [device('device_001'), second];
      const view = render(<FloorPlan selectedBuilding="all" selectedFloor="all" />, { wrapper });
      await screen.findByText('21°F');
      view.rerender(
        <FloorPlan selectedBuilding="Building-A" selectedFloor={scope === 'floor' ? 0 : 'all'} />
      );
      await waitFor(() => expect(latestCalls()).toHaveLength(2));
      push(40, '2026-10-31T10:00:10Z');
      await screen.findByText('40°F');
      view.rerender(<FloorPlan selectedBuilding="all" selectedFloor="all" />);
      expect(screen.getByText('40°F')).toBeInTheDocument();
      expect(latestCalls()).toHaveLength(2);
      push(30, '2026-10-31T10:00:05Z');
      expect(screen.getByText('40°F')).toBeInTheDocument();
    }
  );

  it('does not request readings for an empty building', async () => {
    rows = [];
    render(<FloorPlan selectedBuilding="Building-A" selectedFloor="all" />, { wrapper });
    expect(await screen.findByText('No devices found.')).toBeInTheDocument();
    expect(latestCalls()).toHaveLength(0);
  });

  it('does not let Pusher updates keep an old HTTP snapshot fresh indefinitely', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const view = render(<FloorPlan selectedFloor="all" />, { wrapper });
      await screen.findByText('21°F');
      clock.mockReturnValue(now + 9000);
      push(40, '2026-10-31T10:00:10Z');
      await screen.findByText('40°F');
      view.unmount();
      clock.mockReturnValue(now + 11000);
      render(<FloorPlan selectedFloor="all" />, { wrapper });
      expect(screen.getByText('40°F')).toBeInTheDocument();
      await waitFor(() => expect(latestCalls()).toHaveLength(2));
    } finally {
      clock.mockRestore();
    }
  });

  it('shows loading rather than empty while metadata is pending, and preserves All Buildings', async () => {
    const metadata = deferred<Response>();
    fetchMock.mockImplementation(async url => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/v2/metadata') return metadata.promise;
      if (parsed.pathname === '/api/v2/devices') return deviceResponse(parsed);
      return readings(21);
    });
    render(<FloorPlanPage />, { wrapper });
    expect(screen.getByText('Loading devices…')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/devices'))).toBe(false);
    await act(async () =>
      metadata.resolve(
        response({
          success: true,
          data: {
            buildings: [{ building: 'Building-A', device_count: 1, floors: [{ floor: 0 }] }],
          },
        })
      )
    );
    await screen.findByText('21°F');
    fireEvent.click(screen.getByRole('button', { name: /Building:/ }));
    fireEvent.click(screen.getByRole('option', { name: 'All Buildings' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Building:/ })).toHaveTextContent('All Buildings')
    );
    expect(screen.queryByText('No devices found.')).not.toBeInTheDocument();
  });
});
