/**
 * Alerts API Integration Tests
 */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import AlertV2 from '@/models/v2/AlertV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createAlertInput, createDeviceInput, resetCounters } from '../../setup/factories';
import { mockAuthAsAdmin, mockAuthAsMember } from '../../setup/auth-helpers';

import { GET as listAlerts } from '@/app/api/v2/alerts/route';
import { GET as getAlert, PATCH } from '@/app/api/v2/alerts/[id]/route';

function createMockGetRequest(path: string, searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function createMockPatchRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

async function parseResponse<T>(response: Response): Promise<T> {
  return response.json();
}

describe('Alerts API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
    mockAuthAsAdmin();
  });

  describe('GET /api/v2/alerts', () => {
    it('should default to open alerts and exclude pending and resolved', async () => {
      await AlertV2.create(createAlertInput({ status: 'firing' }));
      await AlertV2.create(createAlertInput({ status: 'acknowledged' }));
      await AlertV2.create(createAlertInput({ status: 'pending' }));
      await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts'));
      const body = await parseResponse<{ data: Array<{ status: string }> }>(response);

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.data.map(a => a.status).sort()).toEqual(['acknowledged', 'firing']);
    });

    it('should never return pending even when explicitly requested', async () => {
      await AlertV2.create(createAlertInput({ status: 'pending' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { status: 'pending' }));
      const body = await parseResponse<{ data: unknown[] }>(response);

      expect(body.data).toHaveLength(0);
    });

    it('should return history when status=resolved', async () => {
      await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { status: 'resolved' }));
      const body = await parseResponse<{ data: unknown[] }>(response);

      expect(body.data).toHaveLength(1);
    });

    it('should filter by severity', async () => {
      await AlertV2.create(createAlertInput({ status: 'firing', severity: 'critical' }));
      await AlertV2.create(createAlertInput({ status: 'firing', severity: 'info' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { severity: 'critical' }));
      const body = await parseResponse<{ data: Array<{ severity: string }> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].severity).toBe('critical');
    });

    it('should filter by device_id', async () => {
      await AlertV2.create(createAlertInput({ status: 'firing', device_id: 'device_aaa' }));
      await AlertV2.create(createAlertInput({ status: 'firing', device_id: 'device_bbb' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { device_id: 'device_aaa' }));
      const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].device_id).toBe('device_aaa');
    });

    it('should paginate', async () => {
      for (let i = 0; i < 5; i++) await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await listAlerts(
        createMockGetRequest('/api/v2/alerts', { page: '2', limit: '2' })
      );
      const body = await parseResponse<{ data: unknown[]; pagination: { total: number; page: number } }>(response);

      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(5);
      expect(body.pagination.page).toBe(2);
    });

    it('should reject an invalid query parameter with 400', async () => {
      const response = await listAlerts(createMockGetRequest('/api/v2/alerts', { severity: 'nuclear' }));
      expect(response.status).toBe(400);
    });

    it('should allow a member to read', async () => {
      mockAuthAsMember();
      await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts'));
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/v2/alerts/[id]', () => {
    it('should return a single alert', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${alert._id}`),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: { _id: string } }>(response);

      expect(response.status).toBe(200);
      expect(body.data._id).toBe(String(alert._id));
    });

    it('should include device details when requested', async () => {
      await DeviceV2.create(createDeviceInput({ _id: 'device_detail' }));
      const alert = await AlertV2.create(
        createAlertInput({ status: 'firing', device_id: 'device_detail' })
      );

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${alert._id}`, { include_device: 'true' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: { device: { _id: string } | null } }>(response);

      expect(body.data.device?._id).toBe('device_detail');
    });

    it('should return null device when the device is gone', async () => {
      const alert = await AlertV2.create(
        createAlertInput({ status: 'firing', device_id: 'device_vanished' })
      );

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${alert._id}`, { include_device: 'true' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: { device: unknown } }>(response);

      expect(body.data.device).toBeNull();
    });

    it('should 404 for an unknown id', async () => {
      const id = String(new Types.ObjectId());

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${id}`),
        { params: params(id) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('ALERT_NOT_FOUND');
    });

    it('should 400 for a malformed id', async () => {
      const response = await getAlert(
        createMockGetRequest('/api/v2/alerts/nope'),
        { params: params('nope') }
      );
      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /api/v2/alerts/[id]', () => {
    it('should acknowledge a firing alert', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: { status: string; is_open: boolean } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe('acknowledged');
      expect(body.data.is_open).toBe(true);
    });

    it('should resolve a firing alert and record a manual resolution', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'resolved', note: 'Swapped sensor' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{
        data: { status: string; is_open: boolean; audit: { resolution: string; note?: string } };
      }>(response);

      expect(body.data.status).toBe('resolved');
      expect(body.data.is_open).toBe(false);
      expect(body.data.audit.resolution).toBe('manual');
      expect(body.data.audit.note).toBe('Swapped sensor');
    });

    it('should return 422 ALERT_ALREADY_ACKNOWLEDGED', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'acknowledged' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('ALERT_ALREADY_ACKNOWLEDGED');
    });

    it('should return 422 ALERT_ALREADY_RESOLVED', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'resolved', is_open: false }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'resolved' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('ALERT_ALREADY_RESOLVED');
    });

    it('should return 422 INVALID_ALERT_STATUS_TRANSITION for a pending alert', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'pending' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('INVALID_ALERT_STATUS_TRANSITION');
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );

      expect(response.status).toBe(403);
    });

    it('should 400 for an unsupported status', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'firing' }),
        { params: params(String(alert._id)) }
      );

      expect(response.status).toBe(400);
    });

    it('should 404 for an unknown id', async () => {
      const id = String(new Types.ObjectId());

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${id}`, { status: 'acknowledged' }),
        { params: params(id) }
      );

      expect(response.status).toBe(404);
    });
  });
});
