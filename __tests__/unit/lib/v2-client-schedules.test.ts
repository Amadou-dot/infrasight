/**
 * V2 API Client - Schedules Coverage Tests
 *
 * Tests for schedulesApi methods in v2-client.ts:
 * - list, getById, create, update, complete, cancel
 */

import { schedulesApi } from '@/lib/api/v2-client';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockClear();
});

// ---------------------------------------------------------------------------
// schedulesApi.list
// ---------------------------------------------------------------------------

describe('schedulesApi.list', () => {
  it('should list schedules without query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          pagination: { total: 0, page: 1, limit: 20 },
        }),
    });

    const result = await schedulesApi.list();

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/schedules', expect.any(Object));
    expect(result.success).toBe(true);
  });

  it('should list schedules with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          pagination: { total: 0, page: 1, limit: 20 },
        }),
    });

    await schedulesApi.list({ status: 'scheduled', service_type: 'calibration' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v2/schedules?');
    expect(calledUrl).toContain('status=scheduled');
    expect(calledUrl).toContain('service_type=calibration');
  });
});

// ---------------------------------------------------------------------------
// schedulesApi.getById
// ---------------------------------------------------------------------------

describe('schedulesApi.getById', () => {
  it('should fetch a schedule by ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { _id: '123', device_id: 'dev_1' },
        }),
    });

    const result = await schedulesApi.getById('123');

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/schedules/123', expect.any(Object));
    expect(result.data._id).toBe('123');
  });

  it('should include include_device query param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { _id: '123', device: { _id: 'dev_1' } },
        }),
    });

    await schedulesApi.getById('123', { include_device: true });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v2/schedules/123?');
    expect(calledUrl).toContain('include_device=true');
  });
});

// ---------------------------------------------------------------------------
// schedulesApi.create
// ---------------------------------------------------------------------------

describe('schedulesApi.create', () => {
  it('should create schedules with POST', async () => {
    const mockResponse = {
      success: true,
      data: { created: [{ _id: '1' }], count: 1 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await schedulesApi.create({
      device_ids: ['dev_1'],
      service_type: 'calibration',
      scheduled_date: new Date(Date.now() + 86400000),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v2/schedules',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(result.data.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// schedulesApi.update
// ---------------------------------------------------------------------------

describe('schedulesApi.update', () => {
  it('should update a schedule with PATCH', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { _id: '123', notes: 'Updated' },
        }),
    });

    const result = await schedulesApi.update('123', { notes: 'Updated' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v2/schedules/123',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(result.data.notes).toBe('Updated');
  });
});

// ---------------------------------------------------------------------------
// schedulesApi.complete
// ---------------------------------------------------------------------------

describe('schedulesApi.complete', () => {
  it('should complete a schedule via PATCH with status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { _id: '123', status: 'completed' },
        }),
    });

    const result = await schedulesApi.complete('123');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v2/schedules/123',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      })
    );
    expect(result.data.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// schedulesApi.cancel
// ---------------------------------------------------------------------------

describe('schedulesApi.cancel', () => {
  it('should cancel a schedule via DELETE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { _id: '123', cancelled: true },
        }),
    });

    const result = await schedulesApi.cancel('123');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v2/schedules/123',
      expect.objectContaining({
        method: 'DELETE',
      })
    );
    expect(result.data.cancelled).toBe(true);
  });
});
