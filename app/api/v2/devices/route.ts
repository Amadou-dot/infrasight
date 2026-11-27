/**
 * V2 Devices API Routes
 *
 * GET /api/v2/devices - List devices with pagination, filtering, and sorting
 * POST /api/v2/devices - Create a new device with full validation
 *
 * Features:
 * - Rate limiting for POST
 * - Request validation
 * - Cache invalidation on create
 * - Metrics and logging
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import DeviceV2, { type IDeviceV2 } from '@/models/v2/DeviceV2';
import {
  createDeviceSchema,
  listDevicesQuerySchema,
} from '@/lib/validations/v2/device.validation';
import { validateQuery, validateInput } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess, jsonPaginated } from '@/lib/api/response';
import { createReadContext } from '@/lib/data/read-context';
import { readDevices } from '@/lib/data/device-reads';

// Phase 5 imports
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { invalidateOnDeviceCreate } from '@/lib/cache';

// Auth
import { requireAdmin, requireOrgMembership, getAuditUser } from '@/lib/auth';

// ============================================================================
// GET /api/v2/devices - List Devices
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require org membership
    const authContext = await requireOrgMembership();

    const context = await createReadContext(authContext.orgId, request.signal);

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, listDevicesQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data;

    if (
      authContext.orgRole !== 'org:admin' &&
      (query.include_deleted || query.only_deleted)
    )
      throw ApiError.forbidden('Admin role required to access deleted devices');

    const { data: result } = await readDevices(context, query);

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/devices', 200, duration);

    logger.debug('Devices list request', {
      duration,
      total: result.paginationInfo.total,
    });

    return jsonPaginated(result.devices, result.paginationInfo);
  })();
}

// ============================================================================
// POST /api/v2/devices - Create Device
// ============================================================================

async function handleCreateDevice(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require authentication
    const authContext = await requireAdmin();
    const auditUser = getAuditUser(authContext.userId, authContext.user);

    await dbConnect();

    // Parse and validate request body
    const body = await request.json();
    const validationResult = validateInput(body, createDeviceSchema);

    if (!validationResult.success) {
      logger.validationFailure('/api/v2/devices', validationResult.errors);
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );
    }

    const deviceData = validationResult.data;

    // Check for duplicate serial number and ID in parallel
    const [existingDevice, existingId] = await Promise.all([
      DeviceV2.findOne({ serial_number: deviceData.serial_number }).lean(),
      DeviceV2.findById(deviceData._id).lean(),
    ]);

    if (existingDevice)
      throw new ApiError(
        ErrorCodes.SERIAL_NUMBER_EXISTS,
        409,
        `Device with serial number '${deviceData.serial_number}' already exists`,
        { field: 'serial_number', value: deviceData.serial_number }
      );

    if (existingId)
      throw new ApiError(
        ErrorCodes.DEVICE_ID_EXISTS,
        409,
        `Device with ID '${deviceData._id}' already exists`,
        { field: '_id', value: deviceData._id }
      );

    // Create device with audit metadata. created_at and updated_at share one clock read
    // so a brand-new device never looks like it was already edited (see DeviceV2 pre-save).
    const now = new Date();
    const deviceDoc: Partial<IDeviceV2> = {
      ...deviceData,
      configuration: deviceData.configuration
        ? {
            ...deviceData.configuration,
            calibration_date: deviceData.configuration.calibration_date || null,
          }
        : undefined,
      audit: {
        created_at: now,
        created_by: auditUser,
        updated_at: now,
        updated_by: auditUser,
      },
      health: {
        last_seen: now,
        uptime_percentage: 100,
        error_count: 0,
        ...deviceData.health,
      },
    };

    // Create the device
    const device = await DeviceV2.create(deviceDoc);

    // Invalidate device caches (non-blocking)
    invalidateOnDeviceCreate(authContext.orgId).catch(() => {
      // Error already logged
    });

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('POST', '/api/v2/devices', 201, duration);

    logger.info('Device created', {
      deviceId: device._id,
      serialNumber: device.serial_number,
      createdBy: auditUser,
      duration,
    });

    return jsonSuccess(device.toObject(), 'Device created successfully', 201);
  })();
}

// Export with middleware: Rate Limiting -> Request Validation -> Handler
export const POST = withRateLimit(
  withRequestValidation(handleCreateDevice, ValidationPresets.jsonApi)
);
