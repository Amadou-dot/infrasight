/**
 * Alerts API Integration Tests
 */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import AlertV2 from '@/models/v2/AlertV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import { createAlertInput, createDeviceInput, resetCounters } from '../../setup/factories';
import { mockAuthAsAdmin, mockAuthAsMember, mockAuthAsUnauthenticated } from '../../setup/auth-helpers';

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

    // __v is Mongoose's internal version key. It is not part of AlertV2Response
    // (types/v2/alert.types.ts) and must never reach a client.
    it('should not expose the internal __v field', async () => {
      await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts'));
      const body = await parseResponse<{ data: Array<Record<string, unknown>> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0]).not.toHaveProperty('__v');
    });

    it('should allow a member to read', async () => {
      mockAuthAsMember();
      await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await listAlerts(createMockGetRequest('/api/v2/alerts'));
      expect(response.status).toBe(200);
    });

    // The date range must filter on `fired_at` (the visible domain event), not
    // `audit.created_at` (stamped when the invisible `pending` episode is first
    // created). With a non-zero for_duration_seconds those two timestamps
    // diverge by the whole duration, so each alert below is built so that
    // filtering on the wrong field returns the wrong alert entirely — these
    // tests would fail if the route reverted to `audit.created_at`.
    describe('date range filtering (fired_at, not audit.created_at)', () => {
      const t1 = new Date('2026-01-01T08:00:00.000Z');
      const t2 = new Date('2026-01-01T09:00:00.000Z');
      const t3 = new Date('2026-01-01T09:30:00.000Z');
      const t4 = new Date('2026-01-01T10:00:00.000Z');

      function auditAt(created_at: Date) {
        return { created_at, created_by: 'system', updated_at: created_at, updated_by: 'system' };
      }

      it('should return the alert whose fired_at falls in the window, not the one whose audit.created_at does', async () => {
        // In range by fired_at, out of range by audit.created_at.
        await AlertV2.create(
          createAlertInput({
            status: 'firing',
            device_id: 'device_fired_in_window',
            fired_at: t2,
            audit: auditAt(t1),
          })
        );
        // Out of range by fired_at, in range by audit.created_at.
        await AlertV2.create(
          createAlertInput({
            status: 'firing',
            device_id: 'device_created_in_window',
            fired_at: t1,
            audit: auditAt(t2),
          })
        );

        const response = await listAlerts(
          createMockGetRequest('/api/v2/alerts', {
            startDate: t2.toISOString(),
            endDate: t3.toISOString(),
          })
        );
        const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

        expect(body.data).toHaveLength(1);
        expect(body.data[0].device_id).toBe('device_fired_in_window');
      });

      it('should filter by fired_at with startDate only', async () => {
        // fired_at after the cutoff, audit.created_at before it.
        await AlertV2.create(
          createAlertInput({
            status: 'firing',
            device_id: 'device_fired_after_cutoff',
            fired_at: t4,
            audit: auditAt(t1),
          })
        );
        // fired_at before the cutoff, audit.created_at after it.
        await AlertV2.create(
          createAlertInput({
            status: 'firing',
            device_id: 'device_created_after_cutoff',
            fired_at: t1,
            audit: auditAt(t4),
          })
        );

        const response = await listAlerts(
          createMockGetRequest('/api/v2/alerts', { startDate: t3.toISOString() })
        );
        const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

        expect(body.data).toHaveLength(1);
        expect(body.data[0].device_id).toBe('device_fired_after_cutoff');
      });

      it('should filter by fired_at with endDate only', async () => {
        // fired_at before the cutoff, audit.created_at after it.
        await AlertV2.create(
          createAlertInput({
            status: 'firing',
            device_id: 'device_fired_before_cutoff',
            fired_at: t1,
            audit: auditAt(t4),
          })
        );
        // fired_at after the cutoff, audit.created_at before it.
        await AlertV2.create(
          createAlertInput({
            status: 'firing',
            device_id: 'device_created_before_cutoff',
            fired_at: t4,
            audit: auditAt(t1),
          })
        );

        const response = await listAlerts(
          createMockGetRequest('/api/v2/alerts', { endDate: t2.toISOString() })
        );
        const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

        expect(body.data).toHaveLength(1);
        expect(body.data[0].device_id).toBe('device_fired_before_cutoff');
      });
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

    it('should not expose the internal __v field', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${alert._id}`),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: Record<string, unknown> }>(response);

      expect(body.data).not.toHaveProperty('__v');
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

    // requireOrgMembership() guards this handler in code but, unlike the list
    // endpoint above, had no test exercising either the member-allowed path or
    // the unauthenticated-rejected path — a silent removal of the guard would
    // break zero tests.
    it('should allow a member to read a single alert', async () => {
      mockAuthAsMember();
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${alert._id}`),
        { params: params(String(alert._id)) }
      );

      expect(response.status).toBe(200);
    });

    it('should reject an unauthenticated request', async () => {
      mockAuthAsUnauthenticated();
      const id = String(new Types.ObjectId());

      const response = await getAlert(
        createMockGetRequest(`/api/v2/alerts/${id}`),
        { params: params(id) }
      );

      expect(response.status).toBe(401);
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

    it('should not expose the internal __v field on the updated alert', async () => {
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      const response = await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'acknowledged' }),
        { params: params(String(alert._id)) }
      );
      const body = await parseResponse<{ data: Record<string, unknown> }>(response);

      expect(body.data).not.toHaveProperty('__v');
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
