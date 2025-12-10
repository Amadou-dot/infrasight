/**
 * Example V2 Device API Routes
 * Demonstrates how to use validation schemas in Next.js API routes
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createDeviceSchema,
  updateDeviceSchema,
  deviceQuerySchema,
  deviceIdSchema,
} from '@/lib/validations/v2';

/**
 * POST /api/v2/devices
 * Create a new device
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request body
    const validatedData = createDeviceSchema.parse(body);
    
    // TODO: Check if serial_number is unique
    // TODO: Save device to database
    
    return NextResponse.json(validatedData, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: error.issues,
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v2/devices
 * List devices with filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = Object.fromEntries(searchParams);
    
    // Validate and parse query parameters
    const validatedParams = deviceQuerySchema.parse(params);
    
    // TODO: Query database with validated parameters
    // Example:
    // const devices = await Device.find({
    //   ...(validatedParams.status && { status: validatedParams.status }),
    //   ...(validatedParams.manufacturer && { manufacturer: validatedParams.manufacturer }),
    // })
    // .skip(validatedParams.offset)
    // .limit(validatedParams.limit)
    // .sort({ [validatedParams.sort_by || 'serial_number']: validatedParams.sort_order === 'desc' ? -1 : 1 });
    
    return NextResponse.json({
      devices: [],
      pagination: {
        offset: validatedParams.offset,
        limit: validatedParams.limit,
        total: 0,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: error.issues,
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v2/devices/:id
 * Update an existing device
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Validate device ID
    const { id } = deviceIdSchema.parse({ id: params.id });
    
    const body = await request.json();
    
    // Validate update data
    const validatedData = updateDeviceSchema.parse(body);
    
    // TODO: Check if device exists
    // TODO: Update device in database
    
    return NextResponse.json({
      message: 'Device updated successfully',
      device: validatedData,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: error.issues,
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v2/devices/:id
 * Delete a device
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Validate device ID
    const { id } = deviceIdSchema.parse({ id: params.id });
    
    // TODO: Check if device exists
    // TODO: Delete device from database
    
    return NextResponse.json({
      message: 'Device deleted successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid device ID',
          details: error.issues,
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
