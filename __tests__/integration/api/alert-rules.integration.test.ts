/**
 * Alert Rules API Integration Tests
 */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import { createAlertRuleInput, resetCounters } from '../../setup/factories';
import { mockAuthAsAdmin, mockAuthAsMember, mockAuthAsUnauthenticated } from '../../setup/auth-helpers';
import * as cache from '@/lib/cache';

import { GET as listRules, POST } from '@/app/api/v2/alert-rules/route';
import { GET as getRule, PATCH, DELETE } from '@/app/api/v2/alert-rules/[id]/route';

function get(path: string, searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function withBody(path: string, method: 'POST' | 'PATCH', body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
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

const VALID_BODY = {
  name: 'High temperature',
  metric: 'value',
  comparison: 'gt',
  threshold: 30,
  severity: 'critical',
  selector: { types: ['temperature'] },
  for_duration_seconds: 300,
};

describe('Alert Rules API Integration Tests', () => {
  beforeEach(() => {
    resetCounters();
    mockAuthAsAdmin();
    jest.spyOn(cache, 'invalidateAlertRules');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/v2/alert-rules', () => {
    it('should list rules and exclude soft-deleted ones', async () => {
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Kept' }));
      const gone = await AlertRuleV2.create(createAlertRuleInput({ name: 'Gone' }));
      await AlertRuleV2.softDelete(String(gone._id), 'admin');

      const response = await listRules(get('/api/v2/alert-rules'));
      const body = await parseResponse<{ data: Array<{ name: string }> }>(response);

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Kept');
    });

    it('should filter by enabled', async () => {
      await AlertRuleV2.create(createAlertRuleInput({ name: 'On' }));
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Off', enabled: false }));

      const response = await listRules(get('/api/v2/alert-rules', { enabled: 'false' }));
      const body = await parseResponse<{ data: Array<{ name: string }> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Off');
    });

    it('should allow a member to read', async () => {
      mockAuthAsMember();
      const response = await listRules(get('/api/v2/alert-rules'));
      expect(response.status).toBe(200);
    });

    // Proves sortBy is actually wired to SORT_FIELD_MAP rather than silently
    // falling back to the default (audit.created_at desc). audit.created_at
    // order (oldest -> newest) is Charlie, Alpha, Bravo — chosen so neither
    // the created_at-asc order [Charlie, Alpha, Bravo] nor the created_at-desc
    // order [Bravo, Alpha, Charlie] coincidentally matches the expected
    // name-asc order [Alpha, Bravo, Charlie]. A collapsed SORT_FIELD_MAP
    // would fall back to created_at desc and fail this assertion.
    it('should sort by name, not silently fall back to created_at', async () => {
      const t1 = new Date('2026-01-01T08:00:00.000Z');
      const t2 = new Date('2026-01-01T09:00:00.000Z');
      const t3 = new Date('2026-01-01T10:00:00.000Z');
      const auditAt = (created_at: Date) => ({
        created_at,
        created_by: 'test@example.com',
        updated_at: created_at,
        updated_by: 'test@example.com',
      });

      await AlertRuleV2.create(createAlertRuleInput({ name: 'Charlie', audit: auditAt(t1) }));
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Alpha', audit: auditAt(t2) }));
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Bravo', audit: auditAt(t3) }));

      const response = await listRules(
        get('/api/v2/alert-rules', { sortBy: 'name', sortDirection: 'asc' })
      );
      const body = await parseResponse<{ data: Array<{ name: string }> }>(response);

      expect(body.data.map(r => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    // __v is Mongoose's internal version key. It is not part of
    // AlertRuleV2Response (types/v2/alert.types.ts) and must never reach a client.
    it('should not expose the internal __v field', async () => {
      await AlertRuleV2.create(createAlertRuleInput());

      const response = await listRules(get('/api/v2/alert-rules'));
      const body = await parseResponse<{ data: Array<Record<string, unknown>> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0]).not.toHaveProperty('__v');
    });
  });

  describe('POST /api/v2/alert-rules', () => {
    it('should create a rule with audit and defaults', async () => {
      const response = await POST(withBody('/api/v2/alert-rules', 'POST', VALID_BODY));
      const body = await parseResponse<{
        data: { _id: string; enabled: boolean; cooldown_seconds: number; audit: { created_by: string } };
      }>(response);

      expect(response.status).toBe(201);
      expect(body.data.enabled).toBe(true);
      expect(body.data.cooldown_seconds).toBe(300);
      expect(body.data.audit.created_by).toBeTruthy();
      expect(await AlertRuleV2.countDocuments({})).toBe(1);
    });

    it('should invalidate the alert rules cache on create', async () => {
      await POST(withBody('/api/v2/alert-rules', 'POST', VALID_BODY));
      expect(cache.invalidateAlertRules).toHaveBeenCalledTimes(1);
    });

    it("should 400 when metric is 'value' and selector.types is missing", async () => {
      const response = await POST(
        withBody('/api/v2/alert-rules', 'POST', { ...VALID_BODY, selector: {} })
      );
      const body = await parseResponse<{ error: { code: string } }>(response);
      expect(response.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should 400 when the threshold is outside the metric bounds', async () => {
      const response = await POST(
        withBody('/api/v2/alert-rules', 'POST', {
          ...VALID_BODY,
          metric: 'anomaly_score',
          threshold: 30,
          selector: {},
        })
      );
      const body = await parseResponse<{ error: { code: string } }>(response);
      expect(response.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const response = await POST(withBody('/api/v2/alert-rules', 'POST', VALID_BODY));
      expect(response.status).toBe(403);
      expect(await AlertRuleV2.countDocuments({})).toBe(0);
    });

    it('should not expose the internal __v field', async () => {
      const response = await POST(withBody('/api/v2/alert-rules', 'POST', VALID_BODY));
      const body = await parseResponse<{ data: Record<string, unknown> }>(response);

      expect(response.status).toBe(201);
      expect(body.data).not.toHaveProperty('__v');
    });
  });

  describe('GET /api/v2/alert-rules/[id]', () => {
    it('should return a single rule', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput({ name: 'Solo' }));

      const response = await getRule(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ data: { name: string } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('Solo');
    });

    it('should 404 for a soft-deleted rule', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());
      await AlertRuleV2.softDelete(String(rule._id), 'admin');

      const response = await getRule(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('ALERT_RULE_NOT_FOUND');
    });

    it('should 404 for an unknown id', async () => {
      const id = String(new Types.ObjectId());
      const response = await getRule(get(`/api/v2/alert-rules/${id}`), { params: params(id) });
      const body = await parseResponse<{ error: { code: string } }>(response);
      expect(response.status).toBe(404);
      expect(body.error.code).toBe('ALERT_RULE_NOT_FOUND');
    });

    it('should not expose the internal __v field', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await getRule(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ data: Record<string, unknown> }>(response);

      expect(body.data).not.toHaveProperty('__v');
    });

    // requireOrgMembership() guards this handler in code but, unlike the list
    // endpoint above, had no test exercising either the member-allowed path or
    // the unauthenticated-rejected path — a silent removal of the guard would
    // break zero tests.
    it('should allow a member to read a single rule', async () => {
      mockAuthAsMember();
      const rule = await AlertRuleV2.create(createAlertRuleInput({ name: 'MemberReadable' }));

      const response = await getRule(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });

      expect(response.status).toBe(200);
    });

    it('should reject an unauthenticated request', async () => {
      mockAuthAsUnauthenticated();
      const id = String(new Types.ObjectId());

      const response = await getRule(get(`/api/v2/alert-rules/${id}`), { params: params(id) });

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /api/v2/alert-rules/[id]', () => {
    it('should toggle enabled', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{ data: { enabled: boolean } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.enabled).toBe(false);
    });

    it('should update the full condition group', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', {
          metric: 'value',
          comparison: 'gte',
          threshold: 45,
          selector: { types: ['temperature', 'humidity'] },
        }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{ data: { threshold: number } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.threshold).toBe(45);
    });

    it('should not expose the internal __v field', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{ data: Record<string, unknown> }>(response);

      expect(body.data).not.toHaveProperty('__v');
    });

    it('should invalidate the alert rules cache on update', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }), {
        params: params(String(rule._id)),
      });

      expect(cache.invalidateAlertRules).toHaveBeenCalledTimes(1);
    });

    it('should 400 on a partial condition update', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { threshold: 45 }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should 400 on an empty body', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', {}), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should 404 for a soft-deleted rule', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());
      await AlertRuleV2.softDelete(String(rule._id), 'admin');

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: true }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('ALERT_RULE_NOT_FOUND');
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );

      expect(response.status).toBe(403);
      const stored = await AlertRuleV2.findById(rule._id).lean();
      expect(stored!.enabled).toBe(true);
    });
  });

  describe('DELETE /api/v2/alert-rules/[id]', () => {
    it('should soft delete, preserving the document', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await DELETE(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ data: { deleted: boolean } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.deleted).toBe(true);

      // Soft, not hard: alerts reference their rule, and hard-deleting would
      // orphan the history that justifies every alert it ever raised.
      const stored = await AlertRuleV2.findById(rule._id).lean();
      expect(stored).not.toBeNull();
      expect(stored!.audit.deleted_at).toBeTruthy();
    });

    it('should exclude the deleted rule from a subsequent list', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput({ name: 'ToDelete' }));
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Stays' }));

      await DELETE(get(`/api/v2/alert-rules/${rule._id}`), { params: params(String(rule._id)) });

      const response = await listRules(get('/api/v2/alert-rules'));
      const body = await parseResponse<{ data: Array<{ name: string }> }>(response);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Stays');
    });

    it('should invalidate the alert rules cache on delete', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      await DELETE(get(`/api/v2/alert-rules/${rule._id}`), { params: params(String(rule._id)) });

      expect(cache.invalidateAlertRules).toHaveBeenCalledTimes(1);
    });

    it('should 404 when already deleted', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());
      await AlertRuleV2.softDelete(String(rule._id), 'admin');

      const response = await DELETE(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ error: { code: string } }>(response);

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('ALERT_RULE_NOT_FOUND');
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await DELETE(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });

      expect(response.status).toBe(403);
      const stored = await AlertRuleV2.findById(rule._id).lean();
      expect(stored!.audit.deleted_at).toBeUndefined();
    });
  });
});
