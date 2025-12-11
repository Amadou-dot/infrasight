/**
 * V2 Metadata API Route
 *
 * GET /api/v2/metadata - Aggregated system metadata (manufacturers, departments, buildings, etc.)
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import { withErrorHandler } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';

// ============================================================================
// GET /api/v2/metadata - System Metadata
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    await dbConnect();

    const searchParams = request.nextUrl.searchParams;
    const includeStats = searchParams.get('include_stats') === 'true';
    const includeInactive = searchParams.get('include_inactive') === 'true';

    // Base match for devices (exclude soft-deleted by default)
    const deviceMatch: Record<string, unknown> = includeInactive
      ? {}
      : { 'audit.deleted_at': null };

    // Get unique manufacturers with device counts
    const manufacturers = await DeviceV2.aggregate([
      { $match: { ...deviceMatch, manufacturer: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$manufacturer',
          count: { $sum: 1 },
          models: { $addToSet: '$device_model' },
        },
      },
      {
        $project: {
          _id: 0,
          name: '$_id',
          device_count: '$count',
          models: {
            $filter: {
              input: '$models',
              cond: { $ne: ['$$this', null] },
            },
          },
        },
      },
      { $sort: { device_count: -1 } },
    ]);

    // Get unique departments with device counts
    const departments = await DeviceV2.aggregate([
      { $match: { ...deviceMatch, 'metadata.department': { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$metadata.department',
          count: { $sum: 1 },
          cost_centers: { $addToSet: '$metadata.cost_center' },
        },
      },
      {
        $project: {
          _id: 0,
          name: '$_id',
          device_count: '$count',
          cost_centers: {
            $filter: {
              input: '$cost_centers',
              cond: { $ne: ['$$this', null] },
            },
          },
        },
      },
      { $sort: { device_count: -1 } },
    ]);

    // Get device type statistics
    const deviceTypes = await DeviceV2.aggregate([
      { $match: deviceMatch },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          offline: { $sum: { $cond: [{ $eq: ['$status', 'offline'] }, 1, 0] } },
          maintenance: { $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          type: '$_id',
          total: '$count',
          by_status: {
            active: '$active',
            offline: '$offline',
            maintenance: '$maintenance',
          },
        },
      },
      { $sort: { total: -1 } },
    ]);

    // Get building/floor/room hierarchy
    const locationHierarchy = await DeviceV2.aggregate([
      { $match: { ...deviceMatch, 'location.building_id': { $exists: true } } },
      {
        $group: {
          _id: {
            building: '$location.building_id',
            floor: '$location.floor',
            room: '$location.room_name',
          },
          device_count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: {
            building: '$_id.building',
            floor: '$_id.floor',
          },
          rooms: {
            $push: {
              room: '$_id.room',
              device_count: '$device_count',
            },
          },
          floor_device_count: { $sum: '$device_count' },
        },
      },
      {
        $group: {
          _id: '$_id.building',
          floors: {
            $push: {
              floor: '$_id.floor',
              device_count: '$floor_device_count',
              rooms: '$rooms',
            },
          },
          building_device_count: { $sum: '$floor_device_count' },
        },
      },
      {
        $project: {
          _id: 0,
          building: '$_id',
          device_count: '$building_device_count',
          floors: {
            $sortArray: { input: '$floors', sortBy: { floor: 1 } },
          },
        },
      },
      { $sort: { building: 1 } },
    ]);

    // Get unique tags
    const tags = await DeviceV2.aggregate([
      { $match: deviceMatch },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          tag: '$_id',
          device_count: '$count',
        },
      },
      { $sort: { device_count: -1 } },
    ]);

    // Basic response
    const response: Record<string, unknown> = {
      manufacturers,
      departments,
      device_types: deviceTypes,
      buildings: locationHierarchy,
      tags,
    };

    // Optional: Include reading statistics
    if (includeStats) {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get reading statistics
      const [readingStats24h, readingStats7d, totalDevices, totalReadings] = await Promise.all([
        ReadingV2.aggregate([
          { $match: { timestamp: { $gte: last24h } } },
          {
            $group: {
              _id: '$metadata.type',
              count: { $sum: 1 },
              avg_value: { $avg: '$value' },
              anomalies: { $sum: { $cond: ['$quality.is_anomaly', 1, 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              type: '$_id',
              count: 1,
              avg_value: { $round: ['$avg_value', 2] },
              anomaly_count: '$anomalies',
            },
          },
        ]),
        ReadingV2.aggregate([
          { $match: { timestamp: { $gte: last7d } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              anomalies: { $sum: { $cond: ['$quality.is_anomaly', 1, 0] } },
              invalid: { $sum: { $cond: [{ $eq: ['$quality.is_valid', false] }, 1, 0] } },
            },
          },
        ]),
        DeviceV2.countDocuments(deviceMatch),
        ReadingV2.estimatedDocumentCount(),
      ]);

      response.statistics = {
        total_devices: totalDevices,
        total_readings: totalReadings,
        last_24_hours: {
          by_type: readingStats24h,
        },
        last_7_days: readingStats7d[0] || { total: 0, anomalies: 0, invalid: 0 },
      };
    }

    // Include schema version info
    response.schema_info = {
      version: 'v2',
      device_collection: 'devices_v2',
      readings_collection: 'readings_v2',
      api_version: '2.0.0',
    };

    return jsonSuccess(response);
  })();
}
