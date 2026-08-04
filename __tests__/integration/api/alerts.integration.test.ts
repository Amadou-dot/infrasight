/**
 * Alerts API Integration Tests
 */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import AlertV2 from '@/models/v2/AlertV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import * as alerting from '@/lib/alerting';
import { createAlertInput, createDeviceInput, resetCounters } from '../../setup/factories';
import { mockAuthAsAdmin, mockAuthAsMember, mockAuthAsUnauthenticated } from '../../setup/auth-helpers';

import { GET as listAlerts } from '@/app/api/v2/alerts/route';
import { GET as getAlert, PATCH } from '@/app/api/v2/alerts/[id]/route';

// Mock Pusher to avoid network errors in tests. A manual resolve now
// broadcasts via publishAlertEvents (Task 13), which every PATCH test below
// reaches unless it separately spies on '@/lib/alerting' — this mock only
// replaces the underlying pusherServer.trigger, so it composes with that spy
// rather than fighting it: when publishAlertEvents itself is mocked, this
// mock is simply never reached.
jest.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: jest.fn().mockResolvedValue(undefined),
  },
}));

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

    it('should filter by rule_id', async () => {
      const ruleIdA = new Types.ObjectId();
      const ruleIdB = new Types.ObjectId();
      await AlertV2.create(
        createAlertInput({ status: 'firing', rule_id: ruleIdA, device_id: 'device_rule_a' })
      );
      await AlertV2.create(
        createAlertInput({ status: 'firing', rule_id: ruleIdB, device_id: 'device_rule_b' })
      );

      const response = await listAlerts(
        createMockGetRequest('/api/v2/alerts', { rule_id: String(ruleIdA) })
      );
      const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].device_id).toBe('device_rule_a');
    });

    // Distinct from "should default to open alerts" above: that test never
    // passes a `status` query param at all, so it exercises the route's OWN
    // default (which happens to also be two values), not a caller-supplied
    // comma-separated list reaching the $in branch. Deliberately mixes an
    // open and a closed status (excluding 'firing') so a regression to
    // single-value-only filtering — `statuses[0]` instead of `{ $in:
    // statuses }` — returns just one alert instead of two.
    it('should accept a comma-separated status list via the $in branch', async () => {
      await AlertV2.create(createAlertInput({ status: 'firing', device_id: 'device_firing' }));
      await AlertV2.create(createAlertInput({ status: 'acknowledged', device_id: 'device_acked' }));
      await AlertV2.create(
        createAlertInput({ status: 'resolved', is_open: false, device_id: 'device_resolved' })
      );

      const response = await listAlerts(
        createMockGetRequest('/api/v2/alerts', { status: 'acknowledged,resolved' })
      );
      const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

      expect(body.data.map(a => a.device_id).sort()).toEqual(['device_acked', 'device_resolved']);
    });

    // Same rationale as the status test above: "should filter by severity"
    // only ever passes a single value, so it cannot tell a working $in branch
    // from one collapsed to single-value equality.
    it('should accept a comma-separated severity list via the $in branch', async () => {
      await AlertV2.create(
        createAlertInput({ status: 'firing', severity: 'critical', device_id: 'device_crit' })
      );
      await AlertV2.create(
        createAlertInput({ status: 'firing', severity: 'warning', device_id: 'device_warn' })
      );
      await AlertV2.create(
        createAlertInput({ status: 'firing', severity: 'info', device_id: 'device_info' })
      );

      const response = await listAlerts(
        createMockGetRequest('/api/v2/alerts', { severity: 'critical,info' })
      );
      const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

      expect(body.data.map(a => a.device_id).sort()).toEqual(['device_crit', 'device_info']);
    });

    // Proves sortBy=severity orders by urgency RANK (critical > warning >
    // info), not lexically and not by silently falling back to
    // audit.created_at. Chosen orderings are deliberately NOT a coincidental
    // match for either fallback:
    //   - severity desc (the fix):    device_crit, device_warn, device_info
    //   - created_at desc (fallback): device_info, device_crit, device_warn
    //   - created_at asc (fallback):  device_warn, device_crit, device_info
    // A collapsed SORT_FIELD_MAP falling back to created_at, in either
    // direction, therefore cannot accidentally satisfy the assertion below.
    async function seedThreeSeverities() {
      const t1 = new Date('2026-01-01T08:00:00.000Z');
      const t2 = new Date('2026-01-01T09:00:00.000Z');
      const t3 = new Date('2026-01-01T10:00:00.000Z');
      const auditAt = (created_at: Date) => ({
        created_at,
        created_by: 'system',
        updated_at: created_at,
        updated_by: 'system',
      });

      await AlertV2.create(
        createAlertInput({
          status: 'firing',
          device_id: 'device_warn',
          severity: 'warning',
          audit: auditAt(t1),
        })
      );
      await AlertV2.create(
        createAlertInput({
          status: 'firing',
          device_id: 'device_crit',
          severity: 'critical',
          audit: auditAt(t2),
        })
      );
      await AlertV2.create(
        createAlertInput({
          status: 'firing',
          device_id: 'device_info',
          severity: 'info',
          audit: auditAt(t3),
        })
      );
    }

    it('should sort by severity rank descending, most severe first', async () => {
      await seedThreeSeverities();

      const response = await listAlerts(
        createMockGetRequest('/api/v2/alerts', { sortBy: 'severity', sortDirection: 'desc' })
      );
      const body = await parseResponse<{
        data: Array<{ _id: string; device_id: string }>;
      }>(response);

      expect(body.data.map(a => a.device_id)).toEqual(['device_crit', 'device_warn', 'device_info']);

      // The route branches to AlertV2.aggregate() for this sort only.
      // aggregate() must serialize identically to the .lean() path used by
      // every other sort: a bare hex-string _id, and __v projected away.
      expect(typeof body.data[0]._id).toBe('string');
      expect(body.data[0]._id).toMatch(/^[a-f0-9]{24}$/);
      expect(body.data[0]).not.toHaveProperty('__v');
    });

    // Proves the rank is genuinely ORDERED (info < warning < critical), not
    // merely "different from lexical" — reversing sortDirection must reverse
    // the whole rank order, not just move 'critical' out of last place.
    it('should sort by severity rank ascending, least severe first', async () => {
      await seedThreeSeverities();

      const response = await listAlerts(
        createMockGetRequest('/api/v2/alerts', { sortBy: 'severity', sortDirection: 'asc' })
      );
      const body = await parseResponse<{ data: Array<{ device_id: string }> }>(response);

      expect(body.data.map(a => a.device_id)).toEqual(['device_info', 'device_warn', 'device_crit']);
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

    it('should broadcast a manual resolution with the user id, never an email', async () => {
      const spy = jest.spyOn(alerting, 'publishAlertEvents').mockResolvedValue(undefined);
      const alert = await AlertV2.create(createAlertInput({ status: 'firing' }));

      await PATCH(
        createMockPatchRequest(`/api/v2/alerts/${alert._id}`, { status: 'resolved' }),
        { params: params(String(alert._id)) }
      );

      const [, resolvedArg] = spy.mock.calls[0];
      expect(resolvedArg[0].actor).toBe('user_test_admin');
      expect(resolvedArg[0].actor).not.toContain('@');

      spy.mockRestore();
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
