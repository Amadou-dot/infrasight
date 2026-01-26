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
  type ListDevicesQuery,
} from '@/lib/validations/v2/device.validation';
import { validateQuery, validateInput } from '@/lib/validations/validator';
import { sanitizeSearchQuery } from '@/lib/validations/sanitizer';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import {
  jsonSuccess,
  jsonPaginated,
} from '@/lib/api/response';
import {
  getOffsetPaginationParams,
  calculateOffsetPagination,
} from '@/lib/api/pagination';

// Phase 5 imports
import { withRateLimit } from '@/lib/ratelimit';
import { withRequestValidation, ValidationPresets } from '@/lib/middleware';
import { logger, recordRequest, createRequestTimer } from '@/lib/monitoring';
import { invalidateOnDeviceCreate, getOrSet, CACHE_TTL, devicesListKey } from '@/lib/cache';

// Auth
import { requireAuth, getAuditUser } from '@/lib/auth';

// ============================================================================
// GET /api/v2/devices - List Devices
// ============================================================================

export async function GET(request: NextRequest) {
  const timer = createRequestTimer();

  return withErrorHandler(async () => {
    // Require authentication
    await requireAuth();

    await dbConnect();

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


    const query = validationResult.data as ListDevicesQuery;

    // Generate cache key based on all query parameters
    const cacheKey = devicesListKey(query as Record<string, unknown>);

    // Use cache-aside pattern
    const result = await getOrSet(
      cacheKey,
      async () => {

    // Extract pagination
    const pagination = getOffsetPaginationParams({
      page: query.page,
      limit: query.limit,
    });

    // Build filter query
    const filter: Record<string, unknown> = {};

    // Status filter
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }

    // Type filter
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      filter.type = types.length === 1 ? types[0] : { $in: types };
    }

    // Location filters
    if (query.building_id) 
      filter['location.building_id'] = query.building_id;
    
    if (query.floor !== undefined) 
      filter['location.floor'] = query.floor;
    
    if (query.zone) 
      filter['location.zone'] = query.zone;
    

    // Metadata filters
    if (query.department) 
      filter['metadata.department'] = query.department;
    
    if (query.manufacturer) 
      filter.manufacturer = query.manufacturer;
    
    if (query.tags) {
      const tags = Array.isArray(query.tags) ? query.tags : [query.tags];
      filter['metadata.tags'] = { $in: tags };
    }

    // Health filters
    if (query.min_battery !== undefined) 
      filter['health.battery_level'] = { 
        ...((filter['health.battery_level'] as Record<string, number>) || {}), 
        $gte: query.min_battery 
      };
    
    if (query.max_battery !== undefined) 
      filter['health.battery_level'] = { 
        ...((filter['health.battery_level'] as Record<string, number>) || {}), 
        $lte: query.max_battery 
      };
    

    // Soft delete filter
    if (query.only_deleted) 
      filter['audit.deleted_at'] = { $exists: true };
     else if (!query.include_deleted) 
      filter['audit.deleted_at'] = { $exists: false };
    

    // Date range filter
    if (query.startDate || query.endDate) {
      const dateField = query.date_filter_field 
        ? (query.date_filter_field === 'last_seen' ? 'health.last_seen' : `audit.${query.date_filter_field}`)
        : 'audit.created_at';
      
      filter[dateField] = {};
      if (query.startDate) 
        (filter[dateField] as Record<string, Date>).$gte = new Date(query.startDate);
      
      if (query.endDate) 
        (filter[dateField] as Record<string, Date>).$lte = new Date(query.endDate);
      
    }

    // Search filter
    if (query.search) {
      const searchRegex = sanitizeSearchQuery(query.search);
      filter.$or = [
        { serial_number: { $regex: searchRegex, $options: 'i' } },
        { 'location.room_name': { $regex: searchRegex, $options: 'i' } },
        { 'metadata.tags': { $regex: searchRegex, $options: 'i' } },
      ];
    }
    

    // Build sort
    const sortOrder = query.sortDirection === 'desc' ? -1 : 1;
    const sortField = query.sortBy || 'created_at';
    const sort: Record<string, 1 | -1> = {};
    
    // Map sort field to actual path
    const sortFieldMap: Record<string, string> = {
      created_at: 'audit.created_at',
      updated_at: 'audit.updated_at',
      last_seen: 'health.last_seen',
      serial_number: 'serial_number',
      status: 'status',
      floor: 'location.floor',
      building_id: 'location.building_id',
      manufacturer: 'manufacturer',
      uptime_percentage: 'health.uptime_percentage',
      battery_level: 'health.battery_level',
    };
    
    sort[sortFieldMap[sortField] || sortField] = sortOrder;

    // Build field projection
    let projection: Record<string, 1> | undefined;
    if (query.fields) {
      projection = {};
      for (const field of query.fields) 
        projection[field] = 1;
      
    }

    // Execute query
    const [devices, total] = await Promise.all([
      DeviceV2.find(filter, projection)
        .sort(sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      DeviceV2.countDocuments(filter),
    ]);

        // Calculate pagination info
        const paginationInfo = calculateOffsetPagination(
          total,
          pagination.page,
          pagination.limit
        );

        return { devices, paginationInfo };
      },
      { ttl: CACHE_TTL.DEVICES_LIST }
    );

    // Record metrics
    const duration = timer.elapsed();
    recordRequest('GET', '/api/v2/devices', 200, duration);

    logger.debug('Devices list request', {
      duration,
      cached: duration < 50,
      cacheKey,
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
    const { userId, user } = await requireAuth();
    const auditUser = getAuditUser(userId, user);

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

    // Check for duplicate serial number
    const existingDevice = await DeviceV2.findOne({
      serial_number: deviceData.serial_number,
    }).lean();

    if (existingDevice)
      throw new ApiError(
        ErrorCodes.SERIAL_NUMBER_EXISTS,
        409,
        `Device with serial number '${deviceData.serial_number}' already exists`,
        { field: 'serial_number', value: deviceData.serial_number }
      );


    // Check for duplicate ID
    const existingId = await DeviceV2.findById(deviceData._id).lean();
    if (existingId)
      throw new ApiError(
        ErrorCodes.DEVICE_ID_EXISTS,
        409,
        `Device with ID '${deviceData._id}' already exists`,
        { field: '_id', value: deviceData._id }
      );


    // Create device with audit metadata
    const deviceDoc: Partial<IDeviceV2> = {
      ...deviceData,
      configuration: deviceData.configuration
        ? {
            ...deviceData.configuration,
            calibration_date: deviceData.configuration.calibration_date || null,
          }
        : undefined,
      audit: {
        created_at: new Date(),
        created_by: auditUser,
        updated_at: new Date(),
        updated_by: auditUser,
      },
      health: {
        last_seen: new Date(),
        uptime_percentage: 100,
        error_count: 0,
        ...deviceData.health,
      },
    };

    // Create the device
    const device = await DeviceV2.create(deviceDoc);

    // Invalidate device caches (non-blocking)
    invalidateOnDeviceCreate().catch(() => {
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
  withRequestValidation(
    handleCreateDevice,
    ValidationPresets.jsonApi
  )
);
