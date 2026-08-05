/**
 * Alert Rules API Integration Tests
 */

import { NextRequest } from 'next/server';
import type Redis from 'ioredis';
import { Types } from 'mongoose';
import { auth, currentUser } from '@clerk/nextjs/server';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import AlertV2 from '@/models/v2/AlertV2';
import { createAlertInput, createAlertRuleInput, resetCounters } from '../../setup/factories';
import { mockAuthAsAdmin, mockAuthAsMember, mockAuthAsUnauthenticated } from '../../setup/auth-helpers';
import * as cache from '@/lib/cache';
import * as alerting from '@/lib/alerting';
import * as monitoring from '@/lib/monitoring';
import { getOrSet } from '@/lib/cache/cache';
import { alertRulesKey } from '@/lib/cache/keys';
import * as redisModule from '@/lib/redis/client';

import { GET as listRules, POST } from '@/app/api/v2/alert-rules/route';
import { GET as getRule, PATCH, DELETE } from '@/app/api/v2/alert-rules/[id]/route';

// A condition change closes open episodes, and closing them now broadcasts
// (see closeEpisodesOrphanedByConditionChange). Mocking the underlying
// pusherServer.trigger rather than publishAlertEvents keeps this composable
// with the tests below that spy on publishAlertEvents itself: when the spy is
// installed this mock is simply never reached.
jest.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: jest.fn().mockResolvedValue(undefined),
  },
}));

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

    // `severity` is advertised as sortable (alert-rule.validation.ts) but was
    // handed straight to Mongo, which sorts the raw string lexically and puts
    // `critical` FIRST ascending / LAST descending — the exact bug already
    // fixed on /api/v2/alerts with a $switch rank, never applied here.
    //
    // The seeded audit.created_at order (oldest -> newest) is warn, crit, info,
    // chosen so that none of the wrong answers can pass by coincidence:
    //   - rank desc (correct):  crit, warn, info
    //   - lexical desc (bug):   warn, info, crit
    //   - lexical asc  (bug):   crit, info, warn
    //   - created_at desc:      info, crit, warn
    //   - created_at asc:       warn, crit, info
    async function seedThreeSeverities() {
      const t1 = new Date('2026-01-01T08:00:00.000Z');
      const t2 = new Date('2026-01-01T09:00:00.000Z');
      const t3 = new Date('2026-01-01T10:00:00.000Z');
      const auditAt = (created_at: Date) => ({
        created_at,
        created_by: 'test@example.com',
        updated_at: created_at,
        updated_by: 'test@example.com',
      });

      await AlertRuleV2.create(
        createAlertRuleInput({ name: 'Warn', severity: 'warning', audit: auditAt(t1) })
      );
      await AlertRuleV2.create(
        createAlertRuleInput({ name: 'Crit', severity: 'critical', audit: auditAt(t2) })
      );
      await AlertRuleV2.create(
        createAlertRuleInput({ name: 'Info', severity: 'info', audit: auditAt(t3) })
      );
    }

    it('should sort by severity rank descending, most severe first', async () => {
      await seedThreeSeverities();

      const response = await listRules(
        get('/api/v2/alert-rules', { sortBy: 'severity', sortDirection: 'desc' })
      );
      const body = await parseResponse<{
        data: Array<{ _id: string; name: string }>;
      }>(response);

      expect(body.data.map(r => r.name)).toEqual(['Crit', 'Warn', 'Info']);

      // This sort is the only one that branches to AlertRuleV2.aggregate().
      // It must serialize identically to the .lean() path every other sort
      // uses: a bare hex-string _id, and __v projected away.
      expect(typeof body.data[0]._id).toBe('string');
      expect(body.data[0]._id).toMatch(/^[a-f0-9]{24}$/);
      expect(body.data[0]).not.toHaveProperty('__v');
    });

    // Proves the rank is genuinely ORDERED (info < warning < critical), not
    // merely "different from lexical": reversing sortDirection must reverse
    // the whole order, not just move `critical` out of last place.
    it('should sort by severity rank ascending, least severe first', async () => {
      await seedThreeSeverities();

      const response = await listRules(
        get('/api/v2/alert-rules', { sortBy: 'severity', sortDirection: 'asc' })
      );
      const body = await parseResponse<{ data: Array<{ name: string }> }>(response);

      expect(body.data.map(r => r.name)).toEqual(['Info', 'Warn', 'Crit']);
    });

    it('should keep pagination and total correct on the severity-rank branch', async () => {
      await seedThreeSeverities();

      const response = await listRules(
        get('/api/v2/alert-rules', {
          sortBy: 'severity',
          sortDirection: 'desc',
          page: '2',
          limit: '2',
        })
      );
      const body = await parseResponse<{
        data: Array<{ name: string }>;
        pagination: { total: number; page: number };
      }>(response);

      expect(body.data.map(r => r.name)).toEqual(['Info']);
      expect(body.pagination.total).toBe(3);
      expect(body.pagination.page).toBe(2);
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

    // ========================================================================
    // CONDITION CHANGES ORPHAN OPEN EPISODES
    // ========================================================================
    //
    // metric/comparison/threshold are SNAPSHOTTED on the alert; last_value and
    // resolved_value are not. Leave an open episode alone across a condition
    // edit and the next evaluation auto-resolves it with a value measured
    // against the NEW metric: switch a temperature rule to battery_level and
    // the episode closes with resolved_value 87 while describeCondition()
    // still renders "value above 30" — permanent history claiming a
    // temperature alert cleared at 87 degrees.
    describe('open episodes across a condition change', () => {
      const NEW_CONDITION = {
        metric: 'battery_level',
        comparison: 'lt',
        threshold: 20,
        selector: {},
      };

      async function seedRuleWithOpenEpisode(status: 'firing' | 'acknowledged' | 'pending') {
        const rule = await AlertRuleV2.create(
          createAlertRuleInput({
            metric: 'value',
            comparison: 'gt',
            threshold: 30,
            selector: { types: ['temperature'] },
          })
        );
        const alert = await AlertV2.create(
          createAlertInput({
            status,
            rule_id: rule._id,
            device_id: `device_${status}`,
            metric: 'value',
            comparison: 'gt',
            threshold: 30,
          })
        );
        return { rule, alert };
      }

      it('should close a firing episode while its own snapshot is still true', async () => {
        const { rule, alert } = await seedRuleWithOpenEpisode('firing');

        const response = await PATCH(
          withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', NEW_CONDITION),
          { params: params(String(rule._id)) }
        );
        expect(response.status).toBe(200);

        const stored = await AlertV2.findById(alert._id).lean();

        expect(stored!.status).toBe('resolved');
        expect(stored!.is_open).toBe(false);

        // The snapshot is left exactly as it fired, so the episode still
        // describes the condition it was actually raised against.
        expect(stored!.metric).toBe('value');
        expect(stored!.comparison).toBe('gt');
        expect(stored!.threshold).toBe(30);

        // Nothing MEASURED this episode closed, so no resolved_value may be
        // invented — that number is the whole substance of the finding.
        expect(stored!.resolved_value).toBeUndefined();

        // 'manual' rather than 'auto': an administrator's action closed it.
        // 'auto' renders as "back within threshold", which would be the same
        // false history in different words.
        expect(stored!.audit.resolution).toBe('manual');
        expect(stored!.audit.resolved_by).toBe('admin@example.com');
        expect(stored!.audit.resolved_at).toBeTruthy();

        // A human reading the timeline must be able to tell what happened.
        expect(stored!.audit.note).toContain('value above 30');
        expect(stored!.audit.note).toContain('battery_level below 20');
      });

      it('should close an acknowledged episode too', async () => {
        const { rule, alert } = await seedRuleWithOpenEpisode('acknowledged');

        await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', NEW_CONDITION), {
          params: params(String(rule._id)),
        });

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.status).toBe('resolved');
        expect(stored!.is_open).toBe(false);
      });

      // `pending` is internal: it is DELETED rather than resolved everywhere
      // else (evaluate.ts, sweep.ts), and the alerts endpoints document that
      // every visible alert has `fired_at`. Resolving one here would make an
      // episode that never fired permanently visible in history.
      it('should delete a pending episode rather than resolve it', async () => {
        const { rule, alert } = await seedRuleWithOpenEpisode('pending');

        await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', NEW_CONDITION), {
          params: params(String(rule._id)),
        });

        expect(await AlertV2.findById(alert._id).lean()).toBeNull();
      });

      it('should leave resolved history untouched', async () => {
        const rule = await AlertRuleV2.create(
          createAlertRuleInput({ metric: 'value', comparison: 'gt', threshold: 30 })
        );
        const closed = await AlertV2.create(
          createAlertInput({
            status: 'resolved',
            is_open: false,
            rule_id: rule._id,
            device_id: 'device_history',
          })
        );

        await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', NEW_CONDITION), {
          params: params(String(rule._id)),
        });

        const stored = await AlertV2.findById(closed._id).lean();
        expect(stored!.audit.resolution).toBe('auto');
        expect(stored!.audit.note).toBeUndefined();
      });

      it('should not touch open episodes belonging to a different rule', async () => {
        const { rule } = await seedRuleWithOpenEpisode('firing');
        const bystander = await AlertV2.create(
          createAlertInput({ status: 'firing', device_id: 'device_bystander' })
        );

        await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', NEW_CONDITION), {
          params: params(String(rule._id)),
        });

        const stored = await AlertV2.findById(bystander._id).lean();
        expect(stored!.status).toBe('firing');
        expect(stored!.is_open).toBe(true);
      });

      it('should leave open episodes alone for a PATCH that does not touch the condition', async () => {
        const { rule, alert } = await seedRuleWithOpenEpisode('firing');

        await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }), {
          params: params(String(rule._id)),
        });

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.status).toBe('firing');
        expect(stored!.is_open).toBe(true);
      });

      // The condition group must be sent whole (Zod enforces it), so a rename
      // that resends the unchanged values is a perfectly ordinary request.
      // Closing every open episode for it would be a nasty surprise.
      it('should leave open episodes alone when the condition group is resent unchanged', async () => {
        const { rule, alert } = await seedRuleWithOpenEpisode('firing');

        await PATCH(
          withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', {
            name: 'Renamed but identical',
            metric: 'value',
            comparison: 'gt',
            threshold: 30,
            selector: { types: ['temperature'] },
          }),
          { params: params(String(rule._id)) }
        );

        const stored = await AlertV2.findById(alert._id).lean();
        expect(stored!.status).toBe('firing');
        expect(stored!.is_open).toBe(true);
      });

      // ======================================================================
      // THE CLOSE HAS TO BE VISIBLE
      // ======================================================================
      //
      // Closing N episodes in the database and telling nobody is the defect
      // this block guards. Nothing patches alert rows into the React Query
      // cache (see useAlertsList's header comment) and refetchOnWindowFocus is
      // off, so an unbroadcast close leaves the alerts list and the nav badge
      // rendering every one of those episodes as firing until something else
      // invalidates them — indefinitely on a wall display. An uncounted one
      // leaves `alerts_resolved` short by N, which is the metric the evaluator
      // and sweep are judged on.
      describe('announcing the close', () => {
        async function seedRuleWithOpenEpisodes(count: number) {
          const rule = await AlertRuleV2.create(
            createAlertRuleInput({
              metric: 'value',
              comparison: 'gt',
              threshold: 30,
              selector: { types: ['temperature'] },
            })
          );

          const alerts = [];
          for (let index = 0; index < count; index += 1)
            alerts.push(
              await AlertV2.create(
                createAlertInput({
                  status: 'firing',
                  rule_id: rule._id,
                  device_id: `device_open_${index}`,
                  metric: 'value',
                  comparison: 'gt',
                  threshold: 30,
                })
              )
            );

          return { rule, alerts };
        }

        function changeCondition(ruleId: string) {
          return PATCH(withBody(`/api/v2/alert-rules/${ruleId}`, 'PATCH', NEW_CONDITION), {
            params: params(ruleId),
          });
        }

        it('should broadcast every closed episode, so connected clients see them resolve', async () => {
          const publishSpy = jest.spyOn(alerting, 'publishAlertEvents').mockResolvedValue(undefined);
          const { rule, alerts } = await seedRuleWithOpenEpisodes(3);

          const response = await changeCondition(String(rule._id));
          expect(response.status).toBe(200);

          expect(publishSpy).toHaveBeenCalledTimes(1);
          const [fired, resolved] = publishSpy.mock.calls[0];

          // Nothing FIRED here — these episodes closed.
          expect(fired).toEqual([]);
          expect(resolved.map(event => event._id).sort()).toEqual(
            alerts.map(alert => String(alert._id)).sort()
          );

          for (const event of resolved) {
            expect(event.rule_id).toBe(String(rule._id));
            expect(event.resolution).toBe('manual');
            expect(event.severity).toBe('warning');
            expect(event.resolved_at).toBeTruthy();
          }
        });

        // The same contract the manual-resolve route is held to: audit.*_by
        // keeps the email, the broadcast carries only the opaque Clerk id.
        // Both strings are in scope in the same handler.
        it('should broadcast the admin user id while persisting their email', async () => {
          const publishSpy = jest.spyOn(alerting, 'publishAlertEvents').mockResolvedValue(undefined);
          const { rule, alerts } = await seedRuleWithOpenEpisodes(1);

          await changeCondition(String(rule._id));

          const [, resolved] = publishSpy.mock.calls[0];
          const stored = await AlertV2.findById(alerts[0]._id).lean();

          expect(resolved[0].actor).toBe('user_test_admin');
          expect(resolved[0].actor).not.toContain('@');
          expect(stored!.audit.resolved_by).toBe('admin@example.com');
          expect(resolved[0].actor).not.toBe(stored!.audit.resolved_by);
        });

        it('should count one resolution per closed episode', async () => {
          const recordSpy = jest.spyOn(monitoring, 'recordAlert');
          const { rule } = await seedRuleWithOpenEpisodes(3);

          await changeCondition(String(rule._id));

          const resolvedCalls = recordSpy.mock.calls.filter(([event]) => event === 'resolved');
          expect(resolvedCalls).toHaveLength(3);
          for (const [, labels] of resolvedCalls)
            expect(labels).toEqual({ resolution: 'manual' });
        });

        // A pending episode was never visible to a client and never counted as
        // fired, so announcing its resolution would invent an alert.
        it('should neither broadcast nor count a deleted pending episode', async () => {
          const publishSpy = jest.spyOn(alerting, 'publishAlertEvents').mockResolvedValue(undefined);
          const recordSpy = jest.spyOn(monitoring, 'recordAlert');
          const { rule } = await seedRuleWithOpenEpisode('pending');

          await changeCondition(String(rule._id));

          expect(publishSpy).not.toHaveBeenCalled();
          expect(recordSpy.mock.calls.filter(([event]) => event === 'resolved')).toHaveLength(0);
        });

        it('should say nothing at all for a PATCH that does not touch the condition', async () => {
          const publishSpy = jest.spyOn(alerting, 'publishAlertEvents').mockResolvedValue(undefined);
          const recordSpy = jest.spyOn(monitoring, 'recordAlert');
          const { rule } = await seedRuleWithOpenEpisodes(2);

          await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }), {
            params: params(String(rule._id)),
          });

          expect(publishSpy).not.toHaveBeenCalled();
          expect(recordSpy.mock.calls.filter(([event]) => event === 'resolved')).toHaveLength(0);
        });

        // The rule update and the episode closes are already committed by the
        // time the broadcast runs, so a broadcast fault has nothing left to
        // roll back and must never become a 500 — but it must not vanish
        // either. logger.error only reaches a console line, so the Sentry
        // escalation is what makes a permanently broken broadcast path visible
        // while every PATCH keeps returning 200. Mirrors the same guarantee on
        // PATCH /api/v2/alerts/[id].
        it('should still return 200 with the episodes closed, and escalate a broadcast failure', async () => {
          const publishSpy = jest
            .spyOn(alerting, 'publishAlertEvents')
            .mockRejectedValue(new Error('envelope construction exploded'));
          const captureSpy = jest.spyOn(monitoring, 'captureException').mockReturnValue(undefined);

          const { rule, alerts } = await seedRuleWithOpenEpisodes(2);

          const response = await changeCondition(String(rule._id));
          expect(response.status).toBe(200);

          for (const alert of alerts) {
            const stored = await AlertV2.findById(alert._id).lean();
            expect(stored!.status).toBe('resolved');
            expect(stored!.is_open).toBe(false);
          }

          expect(publishSpy).toHaveBeenCalledTimes(1);
          expect(captureSpy).toHaveBeenCalledTimes(1);
          expect((captureSpy.mock.calls[0][0] as Error).message).toBe(
            'envelope construction exploded'
          );
          expect(captureSpy.mock.calls[0][2]).toEqual({ subsystem: 'alerting' });
        });
      });
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

  // ==========================================================================
  // DEMO MODE REDACTION (Critical finding from the whole-branch review)
  // ==========================================================================
  //
  // Same contract as alerts.integration.test.ts's "demo mode redaction" block:
  // getAuditUser() resolves audit.*_by to a real email, requireOrgMembership()
  // lets an anonymous demo visitor read this resource, so without redaction
  // that email would leak. Each pair proves both halves: nothing reaches a
  // demo caller, and an authenticated admin still gets the real value.
  describe('demo mode redaction', () => {
    const originalDemoMode = process.env.DEMO_MODE;

    afterEach(() => {
      if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = originalDemoMode;
    });

    /** Simulate an anonymous visitor on a demo deployment: no session, DEMO_MODE on. */
    function mockDemoVisitor() {
      process.env.DEMO_MODE = 'true';
      mockAuthAsUnauthenticated();
    }

    function auditWithRealEmail() {
      const now = new Date();
      return {
        created_at: now,
        created_by: 'admin@example.com',
        updated_at: now,
        updated_by: 'admin@example.com',
      };
    }

    it('should redact audit actor fields for a demo-mode list request', async () => {
      mockDemoVisitor();
      await AlertRuleV2.create(createAlertRuleInput({ audit: auditWithRealEmail() }));

      const response = await listRules(get('/api/v2/alert-rules'));
      const body = await parseResponse<unknown>(response);

      expect(response.status).toBe(200);
      // Blunt but robust: no value anywhere in the payload may contain an
      // email address when the caller is the anonymous demo visitor.
      expect(JSON.stringify(body)).not.toContain('@');
    });

    it('should still return the real actor to a genuinely authenticated admin (list)', async () => {
      mockAuthAsAdmin();
      await AlertRuleV2.create(createAlertRuleInput({ audit: auditWithRealEmail() }));

      const response = await listRules(get('/api/v2/alert-rules'));
      const body = await parseResponse<{ data: Array<{ audit: { created_by?: string } }> }>(
        response
      );

      expect(response.status).toBe(200);
      expect(body.data[0].audit.created_by).toBe('admin@example.com');
    });

    it('should redact audit actor fields for a demo-mode single-rule request', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput({ audit: auditWithRealEmail() }));
      mockDemoVisitor();

      const response = await getRule(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<unknown>(response);

      expect(response.status).toBe(200);
      expect(JSON.stringify(body)).not.toContain('@');
    });

    it('should still return the real actor to a genuinely authenticated admin (single rule)', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput({ audit: auditWithRealEmail() }));

      const response = await getRule(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });
      const body = await parseResponse<{ data: { audit: { created_by?: string } } }>(response);

      expect(response.status).toBe(200);
      expect(body.data.audit.created_by).toBe('admin@example.com');
    });

    // ========================================================================
    // THE MUTATION RESPONSES
    // ========================================================================
    //
    // POST and PATCH here returned audit.created_by/updated_by unredacted,
    // unlike their `alerts/[id]` sibling. requireAdmin() keeps a demo caller
    // out today, so the hole is inert — which is exactly why it needs a test:
    // nothing else would notice if a future RBAC change let a demo visitor
    // through. Rather than asserting a wrapper was called, these drive the
    // ONE input that makes the wrap observable: an admin whose userId is the
    // demo sentinel — precisely the context such a change would produce.
    function mockAuthAsDemoAdmin() {
      (auth as jest.MockedFunction<typeof auth>).mockResolvedValue({
        userId: 'demo',
        orgId: 'org_default',
        orgSlug: 'users',
        orgRole: 'org:admin',
      } as ReturnType<typeof auth> extends Promise<infer T> ? T : never);

      (currentUser as jest.MockedFunction<typeof currentUser>).mockResolvedValue({
        id: 'demo',
        fullName: 'Admin User',
        firstName: 'Admin',
        lastName: 'User',
        primaryEmailAddressId: 'email_1',
        emailAddresses: [{ id: 'email_1', emailAddress: 'admin@example.com' }],
      } as Awaited<ReturnType<typeof currentUser>>);
    }

    it('should redact the audit trail on the create response', async () => {
      mockAuthAsDemoAdmin();

      const response = await POST(withBody('/api/v2/alert-rules', 'POST', VALID_BODY));
      const body = await parseResponse<{
        data: { audit: { created_by: string; updated_by: string } };
      }>(response);

      expect(response.status).toBe(201);
      expect(body.data.audit.created_by).toBe('an administrator');
      expect(body.data.audit.updated_by).toBe('an administrator');
      expect(JSON.stringify(body)).not.toContain('@');
    });

    it('should redact the audit trail on the update response', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput({ audit: auditWithRealEmail() }));
      mockAuthAsDemoAdmin();

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{
        data: { enabled: boolean; audit: { created_by: string; updated_by: string } };
      }>(response);

      expect(response.status).toBe(200);
      expect(body.data.enabled).toBe(false);
      expect(body.data.audit.created_by).toBe('an administrator');
      expect(body.data.audit.updated_by).toBe('an administrator');
      expect(JSON.stringify(body)).not.toContain('@');
    });

    it('should still return the real actor on a mutation by a genuine admin', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput({ audit: auditWithRealEmail() }));

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );
      const body = await parseResponse<{ data: { audit: { updated_by: string } } }>(response);

      expect(body.data.audit.updated_by).toBe('admin@example.com');
    });
  });

  // ==========================================================================
  // THE CACHE REPOPULATION RACE
  // ==========================================================================
  //
  // getOrSet populates the cache AFTER awaiting its fetch. A read that missed
  // just before a rule mutation therefore lands its PRE-mutation value after
  // invalidateAlertRules() has already run, under a fresh 60s TTL, with no
  // self-correction short of that TTL — a disabled rule that keeps firing for
  // up to a minute after an operator switched it off. The interleaving below
  // is explicit rather than timing-dependent, so it can only pass because the
  // stale write is a no-op, never because the window happened to be missed.
  describe('alert rule cache repopulation race', () => {
    const originalRateLimit = process.env.RATE_LIMIT_ENABLED;
    let store: Map<string, string>;
    let fakeRedis: {
      get: jest.Mock;
      setex: jest.Mock;
      del: jest.Mock;
      incr: jest.Mock;
      expire: jest.Mock;
      pipeline: jest.Mock;
      eval: jest.Mock;
    };

    beforeEach(() => {
      // The fake below only implements the cache's command surface; the rate
      // limiter shares this client and would otherwise call into it too.
      process.env.RATE_LIMIT_ENABLED = 'false';

      store = new Map();

      // Enough of a Redis to run BOTH halves of the stale-write guard: the
      // value keys, the per-key epoch counters `del` bumps, and the
      // compare-and-set `getOrSet` commits through. `eval` implements the CAS
      // contract the Lua script encodes rather than interpreting Lua; the
      // script text itself is verified against a real Redis (see the cache
      // unit tests and the P4 report).
      const server = {
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        setex: jest.fn(async (key: string, _ttl: number, value: string) => {
          store.set(key, value);
          return 'OK';
        }),
        del: jest.fn(async (...keys: string[]) => {
          let deleted = 0;
          for (const key of keys) if (store.delete(key)) deleted += 1;
          return deleted;
        }),
        incr: jest.fn(async (key: string) => {
          const next = Number(store.get(key) ?? '0') + 1;
          store.set(key, String(next));
          return next;
        }),
        expire: jest.fn(async (_key: string, _seconds: number) => 1),
        pipeline: jest.fn(() => {
          const queued: Array<() => Promise<unknown>> = [];
          const chain = {
            incr(key: string) {
              queued.push(() => server.incr(key));
              return chain;
            },
            expire(key: string, seconds: number) {
              queued.push(() => server.expire(key, seconds));
              return chain;
            },
            async exec() {
              for (const op of queued) await op();
              return [];
            },
          };
          return chain;
        }),
        eval: jest.fn(
          async (
            _script: string,
            _numKeys: number,
            valueKey: string,
            epochKey: string,
            _ttl: string,
            value: string,
            observedEpoch: string
          ) => {
            if ((store.get(epochKey) ?? '') !== observedEpoch) return 0;
            store.set(valueKey, value);
            return 1;
          }
        ),
      };
      fakeRedis = server;

      jest.spyOn(redisModule, 'getRedisClient').mockReturnValue(fakeRedis as unknown as Redis);
      jest.spyOn(redisModule, 'isRedisAvailable').mockReturnValue(true);
    });

    afterEach(() => {
      if (originalRateLimit === undefined) delete process.env.RATE_LIMIT_ENABLED;
      else process.env.RATE_LIMIT_ENABLED = originalRateLimit;
    });

    /** Lets the test hold a fetch open across the mutation. */
    function deferred() {
      let resolve!: () => void;
      const promise = new Promise<void>(r => {
        resolve = r;
      });
      return { promise, resolve };
    }

    it('should drop a cache write whose value predates an invalidation', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput({ name: 'Racing', enabled: true }));

      const fetched = deferred();
      const release = deferred();

      // 1. A read misses and starts loading the PRE-mutation rule set.
      const inFlight = getOrSet(
        alertRulesKey(),
        async () => {
          const rules = await AlertRuleV2.find({
            enabled: true,
            'audit.deleted_at': { $exists: false },
          }).lean();
          fetched.resolve();
          await release.promise;
          return rules;
        },
        { ttl: 60 }
      );
      await fetched.promise;

      // 2. An admin disables the rule; the route invalidates the cache.
      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );
      expect(response.status).toBe(200);
      expect(fakeRedis.del).toHaveBeenCalledWith(alertRulesKey());

      // 3. The stale read completes and tries to publish what it loaded.
      release.resolve();
      const stale = (await inFlight) as Array<{ enabled: boolean }>;

      // It really is the pre-mutation rule set — otherwise this test would
      // pass for the wrong reason.
      expect(stale).toHaveLength(1);
      expect(stale[0].enabled).toBe(true);

      // getOrSet's write is fire-and-forget; give it every chance to land.
      await new Promise(resolve => setImmediate(resolve));

      // 4. It must not have landed. Not "landed and then expired" — never written.
      expect(store.has(alertRulesKey())).toBe(false);
      expect(fakeRedis.setex).not.toHaveBeenCalled();

      // ...and the route's invalidation left the cross-process mark behind, so
      // an instance that never saw this process's generation counter would
      // have been refused at the CAS too.
      expect(store.get(`${alertRulesKey()}::epoch`)).toBe('1');
    });

    // The guard must cancel stale writes, not all writes: a version check that
    // always fails would pass the test above while permanently disabling the
    // cache.
    it('should still populate the cache when nothing invalidated it', async () => {
      await AlertRuleV2.create(createAlertRuleInput({ name: 'Uncontended' }));

      const rules = await getOrSet(
        alertRulesKey(),
        async () => AlertRuleV2.find({ enabled: true }).lean(),
        { ttl: 60 }
      );

      expect(rules).toHaveLength(1);
      await new Promise(resolve => setImmediate(resolve));

      expect(fakeRedis.eval).toHaveBeenCalledTimes(1);
      await expect(fakeRedis.eval.mock.results[0].value).resolves.toBe(1);
      expect(store.has(alertRulesKey())).toBe(true);
    });

    // An invalidation that ran BEFORE the read started says nothing about the
    // value the read went on to fetch — that value already reflects it.
    it('should still populate the cache after an invalidation that preceded the read', async () => {
      await AlertRuleV2.create(createAlertRuleInput({ name: 'AfterInvalidation' }));
      await cache.invalidateAlertRules();

      await getOrSet(alertRulesKey(), async () => AlertRuleV2.find({ enabled: true }).lean(), {
        ttl: 60,
      });
      await new Promise(resolve => setImmediate(resolve));

      expect(store.has(alertRulesKey())).toBe(true);
    });
  });
});
