/**
 * V2 API Client Coverage Tests
 *
 * Tests for uncovered methods in v2-client.ts:
 * - deviceApi.getHistory
 * - readingsApi.list, readingsApi.latest
 * - analyticsApi.energy (with period/field mapping), health, anomalies,
 *   maintenanceForecast, temperatureCorrelation
 * - metadataApi.get
 * - auditApi.list
 * - fetchWithRetry: exhausted retries returning last response (line 108)
 */

import {
  ApiClientError,
  deviceApi,
  readingsApi,
  analyticsApi,
  metadataApi,
  auditApi,
} from '@/lib/api/v2-client';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockClear();
});

// ---------------------------------------------------------------------------
// deviceApi.getHistory
// ---------------------------------------------------------------------------

describe('deviceApi.getHistory', () => {
  it('should fetch history without query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    const result = await deviceApi.getHistory('device_001');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v2/devices/device_001/history',
      expect.any(Object)
    );
    expect(result.success).toBe(true);
  });

  it('should fetch history with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await deviceApi.getHistory('device_001', {
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      actionType: 'update',
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v2/devices/device_001/history?');
    expect(calledUrl).toContain('startDate=2024-01-01');
    expect(calledUrl).toContain('endDate=2024-01-31');
    expect(calledUrl).toContain('actionType=update');
  });
});

// ---------------------------------------------------------------------------
// readingsApi
// ---------------------------------------------------------------------------

describe('readingsApi.list', () => {
  it('should list readings without query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          pagination: { total: 0, page: 1, limit: 20 },
        }),
    });

    const result = await readingsApi.list();

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/readings', expect.any(Object));
    expect(result.success).toBe(true);
  });

  it('should list readings with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          pagination: { total: 0, page: 1, limit: 20 },
        }),
    });

    await readingsApi.list({ device_id: 'device_001' } as never);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v2/readings?');
    expect(calledUrl).toContain('device_id=device_001');
  });
});

describe('readingsApi.latest', () => {
  it('should fetch latest readings without query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    const result = await readingsApi.latest();

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/readings/latest', expect.any(Object));
    expect(result.success).toBe(true);
  });

  it('should fetch latest readings with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await readingsApi.latest({ device_ids: ['device_001', 'device_002'] } as never);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v2/readings/latest?');
    expect(calledUrl).toContain('device_ids=device_001');
    expect(calledUrl).toContain('device_ids=device_002');
  });
});

// ---------------------------------------------------------------------------
// analyticsApi
// ---------------------------------------------------------------------------

describe('analyticsApi.energy', () => {
  it('should call energy endpoint with no params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy();

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/analytics/energy', expect.any(Object));
  });

  it('should resolve period shorthand to startDate/endDate', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    const before = Date.now();
    await analyticsApi.energy({ period: '24h' });
    const after = Date.now();

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('startDate=');
    expect(calledUrl).toContain('endDate=');
    // Verify startDate is roughly 24 hours ago
    const params = new URLSearchParams(calledUrl.split('?')[1]);
    const startDate = new Date(params.get('startDate')!).getTime();
    const endDate = new Date(params.get('endDate')!).getTime();
    expect(endDate - startDate).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
    expect(endDate).toBeLessThanOrEqual(after);
    expect(endDate).toBeGreaterThanOrEqual(before);
  });

  it('should resolve period with days', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy({ period: '7d' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const params = new URLSearchParams(calledUrl.split('?')[1]);
    const startDate = new Date(params.get('startDate')!).getTime();
    const endDate = new Date(params.get('endDate')!).getTime();
    expect(endDate - startDate).toBeGreaterThanOrEqual(7 * 86400000 - 1000);
  });

  it('should resolve period with weeks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy({ period: '2w' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const params = new URLSearchParams(calledUrl.split('?')[1]);
    const startDate = new Date(params.get('startDate')!).getTime();
    const endDate = new Date(params.get('endDate')!).getTime();
    expect(endDate - startDate).toBeGreaterThanOrEqual(2 * 604800000 - 1000);
  });

  it('should resolve period with months', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy({ period: '1m' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const params = new URLSearchParams(calledUrl.split('?')[1]);
    const startDate = new Date(params.get('startDate')!).getTime();
    const endDate = new Date(params.get('endDate')!).getTime();
    expect(endDate - startDate).toBeGreaterThanOrEqual(2592000000 - 1000);
  });

  it('should map aggregationType to aggregation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy({ aggregationType: 'sum' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('aggregation=sum');
    expect(calledUrl).not.toContain('aggregationType');
  });

  it('should map deviceType to type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy({ deviceType: 'power' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('type=power');
    expect(calledUrl).not.toContain('deviceType');
  });

  it('should map includeInvalid to include_invalid', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy({ includeInvalid: true });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('include_invalid=true');
    expect(calledUrl).not.toContain('includeInvalid');
  });

  it('should map groupBy to group_by', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy({ groupBy: 'floor' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('group_by=floor');
    expect(calledUrl).not.toContain('groupBy');
  });

  it('should pass through floor as-is', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await analyticsApi.energy({ floor: 3 });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('floor=3');
  });
});

describe('analyticsApi.health', () => {
  it('should call health endpoint with no params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await analyticsApi.health();

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/analytics/health', expect.any(Object));
  });

  it('should call health endpoint with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await analyticsApi.health({ floor: 2, building_id: 'b1', department: 'eng' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('floor=2');
    expect(calledUrl).toContain('building_id=b1');
    expect(calledUrl).toContain('department=eng');
  });
});

describe('analyticsApi.anomalies', () => {
  it('should call anomalies endpoint with no params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await analyticsApi.anomalies();

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/analytics/anomalies', expect.any(Object));
  });

  it('should call anomalies endpoint with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await analyticsApi.anomalies({
      deviceId: 'device_001',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      minScore: 0.7,
      limit: 50,
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('deviceId=device_001');
    expect(calledUrl).toContain('minScore=0.7');
    expect(calledUrl).toContain('limit=50');
  });
});

describe('analyticsApi.maintenanceForecast', () => {
  it('should call maintenance-forecast endpoint with no params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await analyticsApi.maintenanceForecast();

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v2/analytics/maintenance-forecast',
      expect.any(Object)
    );
  });

  it('should call maintenance-forecast with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await analyticsApi.maintenanceForecast({ floor: 1 } as never);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v2/analytics/maintenance-forecast?');
    expect(calledUrl).toContain('floor=1');
  });
});

describe('analyticsApi.temperatureCorrelation', () => {
  it('should call temperature-correlation endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await analyticsApi.temperatureCorrelation({
      deviceIds: ['device_001', 'device_002'],
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    } as never);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v2/analytics/temperature-correlation?');
  });
});

// ---------------------------------------------------------------------------
// metadataApi
// ---------------------------------------------------------------------------

describe('metadataApi.get', () => {
  it('should call metadata endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { device_types: [], total_devices: 0 },
        }),
    });

    const result = await metadataApi.get();

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/metadata', expect.any(Object));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// auditApi
// ---------------------------------------------------------------------------

describe('auditApi.list', () => {
  it('should call audit endpoint with no params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          pagination: { total: 0, page: 1, limit: 20 },
        }),
    });

    const result = await auditApi.list();

    expect(mockFetch).toHaveBeenCalledWith('/api/v2/audit', expect.any(Object));
    expect(result.success).toBe(true);
  });

  it('should call audit endpoint with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          pagination: { total: 0, page: 1, limit: 20 },
        }),
    });

    await auditApi.list({
      userId: 'user_123',
      actionType: 'update',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      page: 2,
      limit: 50,
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('userId=user_123');
    expect(calledUrl).toContain('actionType=update');
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('limit=50');
  });
});

// ---------------------------------------------------------------------------
// fetchWithRetry edge case: retries exhausted, returns last response (line 108)
// ---------------------------------------------------------------------------

describe('fetchWithRetry - exhausted retries returning response', () => {
  it('should return error response after exhausting all retries on 500', async () => {
    // All 4 attempts (initial + 3 retries) fail with 500
    const errorResponse = {
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({
          error: { code: 'SERVER_ERROR', message: 'Server down' },
        }),
    };

    mockFetch
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(errorResponse);

    await expect(deviceApi.list()).rejects.toThrow(ApiClientError);
    // 1 initial + 3 retries = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
