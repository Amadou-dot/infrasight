### Task 11: Alert rules API — `/api/v2/alert-rules` and `/api/v2/alert-rules/[id]`

Rules live at `/api/v2/alert-rules`, not `/api/v2/alerts/rules`, so that no static segment competes with the `[id]` dynamic segment. Hyphenated resource names are already established (`temperature-correlation`, `maintenance-forecast`).

**Files:**
- Create: `app/api/v2/alert-rules/route.ts`
- Create: `app/api/v2/alert-rules/[id]/route.ts`
- Test: `__tests__/integration/api/alert-rules.integration.test.ts`

**Interfaces:**
- Consumes: `AlertRuleV2` (Task 1); `createAlertRuleSchema`, `updateAlertRuleSchema`, `listAlertRulesQuerySchema`, `alertRuleIdParamSchema` (Task 3); `invalidateAlertRules` (Task 4).
- Produces:
  - `GET /api/v2/alert-rules` → `jsonPaginated(AlertRuleV2Response[])` (excludes soft-deleted)
  - `POST /api/v2/alert-rules` → `jsonSuccess(AlertRuleV2Response, msg, 201)`
  - `GET /api/v2/alert-rules/[id]` → `jsonSuccess(AlertRuleV2Response)`
  - `PATCH /api/v2/alert-rules/[id]` → `jsonSuccess(AlertRuleV2Response)`
  - `DELETE /api/v2/alert-rules/[id]` → `jsonSuccess({ _id, deleted: true, deleted_at })` (soft delete)

**Every mutation must call `await invalidateAlertRules()`** — otherwise a new or edited rule takes up to 60 seconds to affect evaluation, which is exactly the kind of "it didn't work, oh wait now it does" behaviour that makes an alerting system untrustworthy.

- [ ] **Step 1: Write the failing integration test**

Create `__tests__/integration/api/alert-rules.integration.test.ts`:

```typescript
/**
 * Alert Rules API Integration Tests
 */

import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import { createAlertRuleInput, resetCounters } from '../../setup/factories';
import { mockAuthAsAdmin, mockAuthAsMember } from '../../setup/auth-helpers';

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

    it("should 400 when metric is 'value' and selector.types is missing", async () => {
      const response = await POST(
        withBody('/api/v2/alert-rules', 'POST', { ...VALID_BODY, selector: {} })
      );
      expect(response.status).toBe(400);
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
      expect(response.status).toBe(400);
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const response = await POST(withBody('/api/v2/alert-rules', 'POST', VALID_BODY));
      expect(response.status).toBe(403);
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
      expect(response.status).toBe(404);
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

    it('should 400 on a partial condition update', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { threshold: 45 }),
        { params: params(String(rule._id)) }
      );

      expect(response.status).toBe(400);
    });

    it('should 400 on an empty body', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', {}), {
        params: params(String(rule._id)),
      });

      expect(response.status).toBe(400);
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await PATCH(
        withBody(`/api/v2/alert-rules/${rule._id}`, 'PATCH', { enabled: false }),
        { params: params(String(rule._id)) }
      );

      expect(response.status).toBe(403);
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

    it('should 404 when already deleted', async () => {
      const rule = await AlertRuleV2.create(createAlertRuleInput());
      await AlertRuleV2.softDelete(String(rule._id), 'admin');

      const response = await DELETE(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });

      expect(response.status).toBe(404);
    });

    it('should 403 for a member', async () => {
      mockAuthAsMember();
      const rule = await AlertRuleV2.create(createAlertRuleInput());

      const response = await DELETE(get(`/api/v2/alert-rules/${rule._id}`), {
        params: params(String(rule._id)),
      });

      expect(response.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/integration/api/alert-rules.integration.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write the collection route**

Create `app/api/v2/alert-rules/route.ts`:

```typescript
/**
 * V2 Alert Rules API Routes
 *
 * GET  /api/v2/alert-rules - List rules (soft-deleted excluded)
 * POST /api/v2/alert-rules - Create a rule
 *
 * Path is `/api/v2/alert-rules` rather than `/api/v2/alerts/rules` so that no
 * static segment competes with the `[id]` dynamic segment under /alerts.
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import {
  createAlertRuleSchema,
  listAlertRulesQuerySchema,
  type ListAlertRulesQuery,
} from '@/lib/validations/v2/alert-rule.validation';
import { validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess, jsonPaginated } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { invalidateAlertRules } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';

const SORT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  created_at: 'audit.created_at',
  updated_at: 'audit.updated_at',
  severity: 'severity',
};

// ============================================================================
// GET /api/v2/alert-rules
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const validationResult = validateQuery(request.nextUrl.searchParams, listAlertRulesQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as ListAlertRulesQuery;
    const pagination = getOffsetPaginationParams({ page: query.page, limit: query.limit });

    const filter: Record<string, unknown> = { 'audit.deleted_at': { $exists: false } };
    if (query.enabled !== undefined) filter.enabled = query.enabled;
    if (query.metric) filter.metric = query.metric;
    if (query.severity) filter.severity = query.severity;

    const sortField = SORT_FIELD_MAP[query.sortBy ?? 'created_at'] ?? 'audit.created_at';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortDirection === 'asc' ? 1 : -1 };

    const [rules, total] = await Promise.all([
      AlertRuleV2.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit).lean(),
      AlertRuleV2.countDocuments(filter),
    ]);

    recordRequest('GET', '/api/v2/alert-rules', 200, timer.elapsed());

    return jsonPaginated(
      rules,
      calculateOffsetPagination(total, pagination.page, pagination.limit)
    );
  })();
}

// ============================================================================
// POST /api/v2/alert-rules
// ============================================================================

async function handleCreateAlertRule(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const bodyValidation = await validateBody(request, createAlertRuleSchema);
    if (!bodyValidation.success) {
      logger.validationFailure('/api/v2/alert-rules', bodyValidation.errors);
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );
    }

    const now = new Date();
    const created = await AlertRuleV2.create({
      ...bodyValidation.data,
      audit: {
        created_at: now,
        created_by: auditUser,
        updated_at: now,
        updated_by: auditUser,
      },
    });

    // Without this the new rule takes up to 60s to affect evaluation.
    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('POST', '/api/v2/alert-rules', 201, duration);
    logger.info('Alert rule created', { ruleId: String(created._id), createdBy: auditUser, duration });

    return jsonSuccess(created.toObject(), 'Alert rule created successfully', 201);
  })();
}

export const POST = withRateLimit(
  withRequestValidation(handleCreateAlertRule, ValidationPresets.jsonApi)
);
```

- [ ] **Step 4: Write the single-rule route**

Create `app/api/v2/alert-rules/[id]/route.ts`:

```typescript
/**
 * V2 Single Alert Rule API Routes
 *
 * GET    /api/v2/alert-rules/[id] - Get a rule
 * PATCH  /api/v2/alert-rules/[id] - Update a rule
 * DELETE /api/v2/alert-rules/[id] - Soft delete a rule
 *
 * DELETE is SOFT. Alerts reference their rule; hard-deleting would orphan the
 * history that justifies every alert it ever raised. `enabled: false` is the
 * reversible off switch; deletion is the permanent one.
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertRuleV2 from '@/models/v2/AlertRuleV2';
import {
  updateAlertRuleSchema,
  alertRuleIdParamSchema,
} from '@/lib/validations/v2/alert-rule.validation';
import { validateInput, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { invalidateAlertRules } from '@/lib/cache';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';

function assertValidId(id: string): void {
  const paramValidation = validateInput({ id }, alertRuleIdParamSchema);
  if (!paramValidation.success)
    throw new ApiError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      paramValidation.errors.map(e => e.message).join(', '),
      { errors: paramValidation.errors }
    );
}

// ============================================================================
// GET
// ============================================================================

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const rule = await AlertRuleV2.findOne({
      _id: id,
      'audit.deleted_at': { $exists: false },
    }).lean();

    if (!rule)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    recordRequest('GET', '/api/v2/alert-rules/[id]', 200, timer.elapsed());

    return jsonSuccess(rule);
  })();
}

// ============================================================================
// PATCH
// ============================================================================

async function handleUpdateAlertRule(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const bodyValidation = await validateBody(request, updateAlertRuleSchema);
    if (!bodyValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );

    const updated = await AlertRuleV2.findOneAndUpdate(
      { _id: id, 'audit.deleted_at': { $exists: false } },
      {
        $set: {
          ...bodyValidation.data,
          'audit.updated_at': new Date(),
          'audit.updated_by': auditUser,
        },
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updated)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/alert-rules/[id]', 200, duration);
    logger.info('Alert rule updated', {
      ruleId: id,
      updates: Object.keys(bodyValidation.data),
      updatedBy: auditUser,
      duration,
    });

    return jsonSuccess(updated, 'Alert rule updated successfully');
  })();
}

export const PATCH = withRateLimit(
  withRequestValidation(handleUpdateAlertRule, ValidationPresets.jsonApi)
);

// ============================================================================
// DELETE
// ============================================================================

async function handleDeleteAlertRule(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;
    assertValidId(id);

    const deleted = await AlertRuleV2.softDelete(id, auditUser);

    if (!deleted)
      throw new ApiError(ErrorCodes.ALERT_RULE_NOT_FOUND, 404, `Alert rule '${id}' not found`);

    await invalidateAlertRules();

    const duration = timer.elapsed();
    recordRequest('DELETE', '/api/v2/alert-rules/[id]', 200, duration);
    logger.info('Alert rule deleted', { ruleId: id, deletedBy: auditUser, duration });

    return jsonSuccess(
      { _id: id, deleted: true, deleted_at: deleted.audit?.deleted_at },
      'Alert rule deleted successfully'
    );
  })();
}

export const DELETE = withRateLimit(handleDeleteAlertRule);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/integration/api/alert-rules.integration.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Confirm the v2 surface is now 33 endpoints**

Run: `pnpm test __tests__/integration/api && ./.superpowers/sdd/2026-08-01-alerting-subsystem/tscheck`
Expected: all integration suites green. The v2 API has gone from 25 endpoints to 33.

- [ ] **Step 7: Commit**

```bash
git add app/api/v2/alert-rules __tests__/integration/api/alert-rules.integration.test.ts
git commit -m "feat(alerting): add alert rules API with soft delete and cache invalidation"
```

---

