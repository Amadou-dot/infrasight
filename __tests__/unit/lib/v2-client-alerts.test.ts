/**
 * V2 API Client — Alerts and Alert Rules
 */

import { alertsApi, alertRulesApi } from '@/lib/api/v2-client';

const originalFetch = global.fetch;

function mockJson(data: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => ({ success: status < 400, data, timestamp: new Date().toISOString() }),
  }) as unknown as typeof fetch;
}

function calledUrl(): string {
  return (global.fetch as jest.Mock).mock.calls[0][0] as string;
}

function calledInit(): RequestInit {
  return (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('alertsApi', () => {
  it('should build the list URL with filters', async () => {
    mockJson([]);
    await alertsApi.list({ status: 'firing', severity: 'critical', limit: 10 });

    const url = calledUrl();
    expect(url).toContain('/api/v2/alerts?');
    expect(url).toContain('status=firing');
    expect(url).toContain('severity=critical');
    expect(url).toContain('limit=10');
  });

  it('should request a single alert with include_device', async () => {
    mockJson({});
    await alertsApi.getById('507f1f77bcf86cd799439011', { include_device: true });

    expect(calledUrl()).toBe('/api/v2/alerts/507f1f77bcf86cd799439011?include_device=true');
  });

  it('should PATCH acknowledged', async () => {
    mockJson({});
    await alertsApi.acknowledge('507f1f77bcf86cd799439011');

    expect(calledInit().method).toBe('PATCH');
    expect(JSON.parse(calledInit().body as string)).toEqual({ status: 'acknowledged' });
  });

  it('should PATCH resolved with a note', async () => {
    mockJson({});
    await alertsApi.resolve('507f1f77bcf86cd799439011', 'Swapped sensor');

    expect(JSON.parse(calledInit().body as string)).toEqual({
      status: 'resolved',
      note: 'Swapped sensor',
    });
  });
});

describe('alertRulesApi', () => {
  it('should POST a new rule', async () => {
    mockJson({});
    await alertRulesApi.create({
      name: 'R',
      metric: 'value',
      comparison: 'gt',
      threshold: 30,
      severity: 'warning',
      selector: { types: ['temperature'] },
    });

    expect(calledUrl()).toBe('/api/v2/alert-rules');
    expect(calledInit().method).toBe('POST');
  });

  it('should DELETE a rule', async () => {
    mockJson({});
    await alertRulesApi.delete('507f1f77bcf86cd799439011');

    expect(calledUrl()).toBe('/api/v2/alert-rules/507f1f77bcf86cd799439011');
    expect(calledInit().method).toBe('DELETE');
  });
});
