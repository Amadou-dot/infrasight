/**
 * V2 Single Device API Routes
 *
 * GET /api/v2/devices/[id] - Get a single device by ID
 * PATCH /api/v2/devices/[id] - Update a device
 * DELETE /api/v2/devices/[id] - Soft delete a device
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import {
  updateDeviceSchema,
  getDeviceQuerySchema,
  deviceIdParamSchema,
  type GetDeviceQuery,
} from '@/lib/validations/v2/device.validation';
import { validateInput, validateQuery } from '@/lib/validations/validator';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { requireAuth, getAuditUser } from '@/lib/auth';

// ============================================================================
// GET /api/v2/devices/[id] - Get Single Device
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandler(async () => {
    // Require authentication
    await requireAuth();

    await dbConnect();

    const { id } = await params;

    // Validate path param
    const paramValidation = validateInput({ id }, deviceIdParamSchema);
    if (!paramValidation.success) 
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );
    

    // Validate query params
    const searchParams = request.nextUrl.searchParams;
    const queryValidation = validateQuery(searchParams, getDeviceQuerySchema);
    
    if (!queryValidation.success) 
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        queryValidation.errors.map(e => e.message).join(', '),
        { errors: queryValidation.errors }
      );
    

    const query = queryValidation.data as GetDeviceQuery;

    // Build field projection
    let projection: Record<string, 1> | undefined;
    if (query.fields) {
      projection = {};
      for (const field of query.fields) 
        projection[field] = 1;
      
    }

    // Find device
    const device = await DeviceV2.findById(id, projection).lean();

    if (!device) 
      throw ApiError.notFound('Device', id);
    

    // Check if device is soft-deleted
    if (device.audit?.deleted_at) 
      throw new ApiError(
        ErrorCodes.NOT_FOUND,
        410,
        `Device '${id}' has been deleted`,
        { deleted_at: device.audit.deleted_at, deleted_by: device.audit.deleted_by }
      );
    

    // Include recent readings if requested
    const response: Record<string, unknown> = { ...device };
    
    if (query.include_recent_readings) {
      const readings = await ReadingV2.find({ 'metadata.device_id': id })
        .sort({ timestamp: -1 })
        .limit(query.readings_limit || 10)
        .lean();
      
      response.recent_readings = readings;
    }

    return jsonSuccess(response);
  })();
}

// ============================================================================
// PATCH /api/v2/devices/[id] - Update Device
// ============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandler(async () => {
    // Require authentication
    const { userId, user } = await requireAuth();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;

    // Validate path param
    const paramValidation = validateInput({ id }, deviceIdParamSchema);
    if (!paramValidation.success) 
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );
    

    // Parse and validate body
    const body = await request.json();
    const bodyValidation = validateInput(body, updateDeviceSchema);
    
    if (!bodyValidation.success) 
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        bodyValidation.errors.map(e => e.message).join(', '),
        { errors: bodyValidation.errors }
      );
    

    const updateData = bodyValidation.data;

    // Check if device exists
    const existingDevice = await DeviceV2.findById(id);
    if (!existingDevice) 
      throw ApiError.notFound('Device', id);
    

    // Check if device is soft-deleted
    if (existingDevice.audit?.deleted_at) 
      throw new ApiError(
        ErrorCodes.NOT_FOUND,
        410,
        `Cannot update deleted device '${id}'`,
        { deleted_at: existingDevice.audit.deleted_at }
      );
    

    // Check for duplicate serial number if updating it
    if (updateData.serial_number && updateData.serial_number !== existingDevice.serial_number) {
      const duplicateSerial = await DeviceV2.findOne({ 
        serial_number: updateData.serial_number,
        _id: { $ne: id }
      });
      
      if (duplicateSerial) 
        throw new ApiError(
          ErrorCodes.SERIAL_NUMBER_EXISTS,
          409,
          `Serial number '${updateData.serial_number}' is already in use`,
          { field: 'serial_number' }
        );
      
    }

    // Build update object with nested fields
    const updateObj: Record<string, unknown> = {};

    // Handle top-level fields
    const topLevelFields = ['serial_number', 'manufacturer', 'firmware_version', 'status', 'status_reason'];
    for (const field of topLevelFields) 
      if (field in updateData) 
        updateObj[field] = updateData[field as keyof typeof updateData];
      
    

    // Map 'model' to 'device_model'
    if ('model' in updateData) 
      updateObj.device_model = updateData.model;
    

    // Handle nested configuration updates
    if (updateData.configuration) 
      for (const [key, value] of Object.entries(updateData.configuration)) 
        updateObj[`configuration.${key}`] = value;
      
    

    // Handle nested location updates
    if (updateData.location) 
      for (const [key, value] of Object.entries(updateData.location)) 
        updateObj[`location.${key}`] = value;
      
    

    // Handle nested metadata updates
    if (updateData.metadata) 
      for (const [key, value] of Object.entries(updateData.metadata)) 
        updateObj[`metadata.${key}`] = value;
      
    

    // Handle nested compliance updates
    if (updateData.compliance) 
      for (const [key, value] of Object.entries(updateData.compliance)) 
        updateObj[`compliance.${key}`] = value;
      
    

    // Handle nested health updates
    if (updateData.health) 
      for (const [key, value] of Object.entries(updateData.health)) 
        updateObj[`health.${key}`] = value;
      
    

    // Update audit trail
    updateObj['audit.updated_at'] = new Date();
    updateObj['audit.updated_by'] = auditUser;

    // Perform update
    const updatedDevice = await DeviceV2.findByIdAndUpdate(
      id,
      { $set: updateObj },
      { new: true, runValidators: true }
    ).lean();

    return jsonSuccess(updatedDevice, 'Device updated successfully');
  })();
}

// ============================================================================
// DELETE /api/v2/devices/[id] - Soft Delete Device
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandler(async () => {
    // Require authentication
    const { userId, user } = await requireAuth();
    const auditUser = getAuditUser(userId, user);

    await dbConnect();

    const { id } = await params;

    // Validate path param
    const paramValidation = validateInput({ id }, deviceIdParamSchema);
    if (!paramValidation.success) 
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        paramValidation.errors.map(e => e.message).join(', '),
        { errors: paramValidation.errors }
      );
    

    // Check if device exists
    const device = await DeviceV2.findById(id);
    if (!device) 
      throw ApiError.notFound('Device', id);
    

    // Check if already deleted
    if (device.audit?.deleted_at) 
      throw new ApiError(
        ErrorCodes.NOT_FOUND,
        410,
        `Device '${id}' is already deleted`,
        { deleted_at: device.audit.deleted_at }
      );
    

    // Perform soft delete
    const deletedDevice = await DeviceV2.softDelete(id, auditUser);

    return jsonSuccess(
      { 
        _id: id, 
        deleted: true, 
        deleted_at: deletedDevice?.audit?.deleted_at 
      },
      'Device deleted successfully'
    );
  })();
}
