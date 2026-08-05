### Task 10: Alerts API — `GET /api/v2/alerts`, `GET|PATCH /api/v2/alerts/[id]`

**Files:**
- Create: `app/api/v2/alerts/route.ts`
- Create: `app/api/v2/alerts/[id]/route.ts`
- Test: `__tests__/integration/api/alerts.integration.test.ts`

**There is no `DELETE` on alerts.** An alert is resolved, never cancelled and never removed — the history is the point. Transitions go through `PATCH { status }` dispatching to the atomic statics, following `ScheduleV2`, not through action sub-routes.

**Interfaces:**
- Consumes: `AlertV2`, `AlertTransitionError`, `AlertTransitionCode` (Task 2); `listAlertsQuerySchema`, `getAlertQuerySchema`, `updateAlertSchema`, `alertIdParamSchema` (Task 3); new `ErrorCodes` (Task 2); `recordAlert` (Task 4).
- Produces:
  - `GET /api/v2/alerts` → `jsonPaginated(AlertV2Response[])`, defaults to open alerts (`firing` + `acknowledged`), **never returns `pending`**
  - `GET /api/v2/alerts/[id]` → `jsonSuccess(AlertV2Response)`
  - `PATCH /api/v2/alerts/[id]` → `jsonSuccess(AlertV2Response)`
  - Exported `const PATCH = withRateLimit(withRequestValidation(handleUpdateAlert, ValidationPresets.jsonApi))`

- [ ] **Step 1: Write the failing integration test**

Create `__tests__/integration/api/alerts.integration.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/integration/api/alerts.integration.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write the list route**

Create `app/api/v2/alerts/route.ts`:

```typescript
/**
 * V2 Alerts API Route
 *
 * GET /api/v2/alerts - List alerts with pagination, filtering, and sorting
 *
 * Defaults to OPEN alerts (firing + acknowledged) and NEVER returns `pending`.
 * `pending` is an internal state: it is what makes for_duration_seconds work
 * without a second state store, it raises no notification, and it is deleted
 * rather than resolved when the condition clears.
 *
 * Deliberately NOT cached. The list changes on every ingest and is already pushed
 * over Pusher; a cache-aside layer would add staleness in exchange for nothing.
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertV2 from '@/models/v2/AlertV2';
import {
  listAlertsQuerySchema,
  type ListAlertsQuery,
} from '@/lib/validations/v2/alert.validation';
import { validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonPaginated } from '@/lib/api/response';
import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { requireOrgMembership } from '@/lib/auth';

/** Statuses a client may ever see. `pending` is internal and always excluded. */
const VISIBLE_STATUSES = ['firing', 'acknowledged', 'resolved'] as const;
const OPEN_STATUSES = ['firing', 'acknowledged'] as const;

const SORT_FIELD_MAP: Record<string, string> = {
  created_at: 'audit.created_at',
  fired_at: 'fired_at',
  severity: 'severity',
  status: 'status',
  last_observed_at: 'last_observed_at',
};

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const validationResult = validateQuery(request.nextUrl.searchParams, listAlertsQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as ListAlertsQuery;
    const pagination = getOffsetPaginationParams({ page: query.page, limit: query.limit });

    const filter: Record<string, unknown> = {};

    // Intersect whatever the caller asked for with the visible set, so `pending`
    // can never leak through an explicit status filter.
    const requested = query.status
      ? (Array.isArray(query.status) ? query.status : [query.status])
      : [...OPEN_STATUSES];
    const statuses = requested.filter(s => (VISIBLE_STATUSES as readonly string[]).includes(s));
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };

    if (query.severity) {
      const severities = Array.isArray(query.severity) ? query.severity : [query.severity];
      filter.severity = severities.length === 1 ? severities[0] : { $in: severities };
    }

    if (query.device_id) filter.device_id = query.device_id;
    if (query.rule_id) filter.rule_id = query.rule_id;

    if (query.startDate || query.endDate) {
      const range: Record<string, Date> = {};
      if (query.startDate) range.$gte = new Date(query.startDate);
      if (query.endDate) range.$lte = new Date(query.endDate);
      filter['audit.created_at'] = range;
    }

    const sortField = SORT_FIELD_MAP[query.sortBy ?? 'created_at'] ?? 'audit.created_at';
    const sort: Record<string, 1 | -1> = { [sortField]: query.sortDirection === 'asc' ? 1 : -1 };

    const [alerts, total] = await Promise.all([
      AlertV2.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit).lean(),
      AlertV2.countDocuments(filter),
    ]);

    const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/alerts', 200, duration);
    logger.debug('Alerts list request', { duration, total, statuses });

    return jsonPaginated(alerts, paginationInfo);
  })();
}
```

- [ ] **Step 4: Write the single-alert route**

Create `app/api/v2/alerts/[id]/route.ts`:

```typescript
/**
 * V2 Single Alert API Routes
 *
 * GET   /api/v2/alerts/[id] - Get a single alert
 * PATCH /api/v2/alerts/[id] - Acknowledge or resolve
 *
 * There is no DELETE. An alert is resolved, never cancelled and never removed —
 * the history is the point.
 *
 * Status Transition Rules:
 *   firing       -> acknowledged | resolved
 *   acknowledged -> resolved
 *   resolved     -> (terminal)
 *   pending      -> (internal; not a legal PATCH target)
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import AlertV2, {
  AlertTransitionError,
  type AlertTransitionCode,
} from '@/models/v2/AlertV2';
import DeviceV2 from '@/models/v2/DeviceV2';
import {
  updateAlertSchema,
  getAlertQuerySchema,
  alertIdParamSchema,
  type GetAlertQuery,
} from '@/lib/validations/v2/alert.validation';
import { validateInput, validateQuery, validateBody } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';
import { logger, recordRequest, createRequestTimer, recordAlert } from '@/lib/monitoring';

// ============================================================================
// GET /api/v2/alerts/[id]
// ============================================================================

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    await requireOrgMembership();
    await dbConnect();

    const { id } = await params;

    const paramValidation = validateInput({ id }, alertIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    const queryValidation = validateQuery(request.nextUrl.searchParams, getAlertQuerySchema);
    if (!queryValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        queryValidation.errors.map(e => e.message).join(', '),
        { errors: queryValidation.errors }
      );

    const query = queryValidation.data as GetAlertQuery;

    const alert = await AlertV2.findById(id).lean();
    if (!alert) throw new ApiError(ErrorCodes.ALERT_NOT_FOUND, 404, `Alert '${id}' not found`);

    const response: Record<string, unknown> = { ...alert };

    if (query.include_device) {
      const device = await DeviceV2.findById(alert.device_id)
        .select('_id serial_number type location')
        .lean();

      response.device = device
        ? {
            _id: device._id,
            serial_number: device.serial_number,
            type: device.type,
            location: {
              building_id: device.location?.building_id,
              floor: device.location?.floor,
              room_name: device.location?.room_name,
            },
          }
        : null;

      if (!device)
        logger.warn('Device not found for alert', { alertId: id, deviceId: alert.device_id });
    }

    recordRequest('GET', '/api/v2/alerts/[id]', 200, timer.elapsed());

    return jsonSuccess(response);
  })();
}

// ============================================================================
// ERROR MAPPING HELPER
// ============================================================================

/**
 * Three codes, not four. ScheduleV2 needs four because its two terminal targets
 * are symmetric — either can block the other. Alerts are not symmetric:
 * `acknowledged` sits between `firing` and `resolved`.
 */
const TRANSITION_CODE_MAP: Record<AlertTransitionCode, { code: string; message: string }> = {
  ALREADY_ACKNOWLEDGED: {
    code: ErrorCodes.ALERT_ALREADY_ACKNOWLEDGED,
    message: 'Alert is already acknowledged',
  },
  ALREADY_RESOLVED: {
    code: ErrorCodes.ALERT_ALREADY_RESOLVED,
    message: 'Alert is already resolved',
  },
  NOT_YET_FIRING: {
    code: ErrorCodes.INVALID_ALERT_STATUS_TRANSITION,
    message: 'Alert has not fired yet and cannot be acknowledged or resolved',
  },
};

function rethrowAsApiError(error: unknown): never {
  if (error instanceof AlertTransitionError) {
    const mapped = TRANSITION_CODE_MAP[error.code];
    throw new ApiError(mapped.code, 422, mapped.message);
  }
  throw error;
}

// ============================================================================
// PATCH /api/v2/alerts/[id]
// ============================================================================

async function handleUpdateAlert(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    const { userId, user } = await requireAdmin();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;

    const paramValidation = validateInput({ id }, alertIdParamSchema);
    if (!paramValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );

    const bodyValidation = await validateBody(request, updateAlertSchema);
    if (!bodyValidation.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );

    const { status, note } = bodyValidation.data;

    const updated =
      status === 'acknowledged'
        ? await AlertV2.acknowledge(id, auditUser).catch(rethrowAsApiError)
        : await AlertV2.resolve(id, auditUser, 'manual').catch(rethrowAsApiError);

    if (!updated) throw new ApiError(ErrorCodes.ALERT_NOT_FOUND, 404, `Alert '${id}' not found`);

    if (note) {
      updated.audit.note = note;
      await updated.save();
    }

    if (status === 'resolved') recordAlert('resolved', { resolution: 'manual' });

    const duration = timer.elapsed();
    recordRequest('PATCH', '/api/v2/alerts/[id]', 200, duration);
    logger.info('Alert transitioned', { alertId: id, status, by: auditUser, duration });

    return jsonSuccess(
      updated.toObject(),
      status === 'acknowledged' ? 'Alert acknowledged' : 'Alert resolved'
    );
  })();
}

export const PATCH = withRateLimit(
  withRequestValidation(handleUpdateAlert, ValidationPresets.jsonApi)
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test __tests__/integration/api/alerts.integration.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/v2/alerts __tests__/integration/api/alerts.integration.test.ts
git commit -m "feat(alerting): add alerts API with atomic PATCH transitions"
```

---

