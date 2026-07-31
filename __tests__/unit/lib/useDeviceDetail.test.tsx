/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { ApiClientError, v2Api } from '@/lib/api/v2-client';
import { useDeviceDetail } from '@/components/devices/useDeviceDetail';

jest.mock('@/lib/api/v2-client', () => {
  class MockApiClientError extends Error {
    constructor(
      public statusCode: number,
      public errorCode: string,
      message: string
    ) {
      super(message);
      this.name = 'ApiClientError';
    }
  }

  return {
    ApiClientError: MockApiClientError,
    v2Api: {
      devices: {
        getById: jest.fn(),
        getHistory: jest.fn(),
      },
      readings: {
        list: jest.fn(),
      },
    },
  };
});

const getById = v2Api.devices.getById as jest.Mock;
const getHistory = v2Api.devices.getHistory as jest.Mock;
const listReadings = v2Api.readings.list as jest.Mock;

const device = { _id: 'device_001', type: 'temperature', status: 'active' };

function mockHappyPath() {
  getById.mockResolvedValue({ success: true, data: device });
  listReadings.mockResolvedValue({
    success: true,
    data: [{ timestamp: '2026-07-30T11:00:00.000Z', value: 21.5 }],
  });
  getHistory.mockResolvedValue({
    success: true,
    data: {
      history: [
        {
          timestamp: '2026-07-30T10:00:00.000Z',
          action: 'update',
          user: 'admin@example.com',
          changes: [{ field: 'status', old_value: 'offline', new_value: 'active' }],
        },
      ],
    },
  });
}

describe('useDeviceDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not fetch without a device id', () => {
    const { result } = renderHook(() => useDeviceDetail(null));

    expect(getById).not.toHaveBeenCalled();
    expect(result.current.device).toBeNull();
  });

  it('should not fetch while disabled, so a closed modal stays idle', () => {
    mockHappyPath();

    renderHook(() => useDeviceDetail('device_001', false));

    expect(getById).not.toHaveBeenCalled();
  });

  it('should load the device, its readings, and its audit history', async () => {
    mockHappyPath();

    const { result } = renderHook(() => useDeviceDetail('device_001'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.device).toEqual(device);
    expect(result.current.recentReadings).toHaveLength(1);
    expect(result.current.auditLog).toEqual([
      {
        timestamp: '2026-07-30T10:00:00.000Z',
        action: 'update',
        user: 'admin@example.com',
        changes: { status: { old: 'offline', new: 'active' } },
      },
    ]);
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it('should request a 24 hour window of readings', async () => {
    mockHappyPath();

    const { result } = renderHook(() => useDeviceDetail('device_001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const params = listReadings.mock.calls[0][0];
    const spanMs = new Date(params.endDate).getTime() - new Date(params.startDate).getTime();

    expect(params.device_id).toBe('device_001');
    expect(spanMs).toBe(24 * 60 * 60 * 1000);
  });

  it('should report a missing device as not found rather than an error', async () => {
    getById.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Device not found'));

    const { result } = renderHook(() => useDeviceDetail('device_ghost'));

    await waitFor(() => expect(result.current.notFound).toBe(true));

    expect(result.current.device).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should surface other failures as an error message', async () => {
    getById.mockRejectedValue(new ApiClientError(500, 'INTERNAL', 'Database unavailable'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useDeviceDetail('device_001'));

    await waitFor(() => expect(result.current.error).toBe('Database unavailable'));

    expect(result.current.notFound).toBe(false);

    error.mockRestore();
  });

  it('should still render the device when audit history is forbidden', async () => {
    mockHappyPath();
    getHistory.mockRejectedValue(new ApiClientError(403, 'FORBIDDEN', 'Admin only'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useDeviceDetail('device_001'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.device).toEqual(device);
    expect(result.current.auditLog).toEqual([]);
    expect(result.current.error).toBeNull();

    warn.mockRestore();
  });
});
