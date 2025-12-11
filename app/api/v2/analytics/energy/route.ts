/**
 * V2 Energy Analytics API Route
 *
 * GET /api/v2/analytics/energy - Energy/reading analytics with aggregation
 */

import { jsonSuccess } from '@/lib/api/response';
import dbConnect from '@/lib/db';
import { ApiError, ErrorCodes, withErrorHandler } from '@/lib/errors';
import {
  readingAnalyticsQuerySchema,
  type ReadingAnalyticsQuery,
} from '@/lib/validations/v2/reading.validation';
import { validateQuery } from '@/lib/validations/validator';
import ReadingV2 from '@/models/v2/ReadingV2';
import type { PipelineStage } from 'mongoose';
import type { NextRequest } from 'next/server';

// ============================================================================
// Helper: Get date format string for granularity
// ============================================================================

function getDateFormat(granularity: string): string {
  switch (granularity) {
    case 'second':
      return '%Y-%m-%dT%H:%M:%S';
    case 'minute':
      return '%Y-%m-%dT%H:%M:00';
    case 'hour':
      return '%Y-%m-%dT%H:00:00';
    case 'day':
      return '%Y-%m-%d';
    case 'week':
      return '%Y-W%V';
    case 'month':
      return '%Y-%m';
    default:
      throw new ApiError(
        ErrorCodes.INVALID_INPUT,
        400,
        `Invalid granularity: ${granularity}`
      );
  }
}

// ============================================================================
// Helper: Build aggregation operator
// ============================================================================

function getAggregationOperator(type: string): Record<string, unknown> {
  switch (type) {
    case 'sum':
      return { $sum: '$value' };
    case 'avg':
      return { $avg: '$value' };
    case 'min':
      return { $min: '$value' };
    case 'max':
      return { $max: '$value' };
    case 'count':
      return { $sum: 1 };
    case 'first':
      return { $first: '$value' };
    case 'last':
      return { $last: '$value' };
    case 'raw':
      return { $push: '$value' };
    default:
      return { $avg: '$value' };
  }
}

// ============================================================================
// Helper: Calculate comparison period date range
// ============================================================================

type CompareWithOption = 'previous_period' | 'same_period_last_week' | 'same_period_last_month';

interface ComparisonDateRange {
  startDate: Date;
  endDate: Date;
  label: string;
}

function getComparisonDateRange(
  startDate: Date,
  endDate: Date,
  compareWith: CompareWithOption
): ComparisonDateRange {
  const periodDuration = endDate.getTime() - startDate.getTime();

  switch (compareWith) {
    case 'previous_period': {
      // Same duration, immediately before the current period
      const comparisonEnd = new Date(startDate.getTime() - 1); // 1ms before current start
      const comparisonStart = new Date(comparisonEnd.getTime() - periodDuration);
      return {
        startDate: comparisonStart,
        endDate: comparisonEnd,
        label: 'Previous Period',
      };
    }
    case 'same_period_last_week': {
      // Same time range, 7 days earlier
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      return {
        startDate: new Date(startDate.getTime() - weekMs),
        endDate: new Date(endDate.getTime() - weekMs),
        label: 'Same Period Last Week',
      };
    }
    case 'same_period_last_month': {
      // Same time range, 1 month earlier
      const comparisonStart = new Date(startDate);
      comparisonStart.setMonth(comparisonStart.getMonth() - 1);
      const comparisonEnd = new Date(endDate);
      comparisonEnd.setMonth(comparisonEnd.getMonth() - 1);
      return {
        startDate: comparisonStart,
        endDate: comparisonEnd,
        label: 'Same Period Last Month',
      };
    }
  }
}

// ============================================================================
// Helper: Check if group_by requires device lookup
// ============================================================================

type GroupByOption = 'device' | 'type' | 'floor' | 'room' | 'building' | 'department';

function requiresDeviceLookup(groupBy: GroupByOption): boolean {
  return ['floor', 'room', 'building', 'department'].includes(groupBy);
}

// ============================================================================
// GET /api/v2/analytics/energy - Energy Analytics
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(
      searchParams,
      readingAnalyticsQuerySchema
    );
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as ReadingAnalyticsQuery;

    // Build match stage
    const matchStage: Record<string, unknown> = {};

    // Device filter
    if (query.device_id) {
      const deviceIds = Array.isArray(query.device_id)
        ? query.device_id
        : [query.device_id];
      matchStage['metadata.device_id'] =
        deviceIds.length === 1 ? deviceIds[0] : { $in: deviceIds };
    }

    // Type filter
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      matchStage['metadata.type'] =
        types.length === 1 ? types[0] : { $in: types };
    }

    // Time range filter
    if (query.startDate || query.endDate) {
      matchStage.timestamp = {};
      if (query.startDate)
        (matchStage.timestamp as Record<string, Date>).$gte = new Date(
          query.startDate
        );

      if (query.endDate)
        (matchStage.timestamp as Record<string, Date>).$lte = new Date(
          query.endDate
        );
    }

    // Quality filter
    if (!query.include_invalid) matchStage['quality.is_valid'] = true;

    // Build group stage based on granularity and group_by
    const dateFormat = getDateFormat(query.granularity || 'hour');
    const aggOperator = getAggregationOperator(query.aggregation || 'avg');

    // Build group _id based on group_by option
    const groupId: Record<string, unknown> = {
      time_bucket: {
        $dateToString: { format: dateFormat, date: '$timestamp' },
      },
    };

    // Determine if we need a $lookup for device-based grouping
    const needsLookup = query.group_by && requiresDeviceLookup(query.group_by as GroupByOption);

    if (query.group_by)
      switch (query.group_by) {
        case 'device':
          groupId.device_id = '$metadata.device_id';
          break;
        case 'type':
          groupId.type = '$metadata.type';
          break;
        case 'floor':
          // After $lookup, device info is in 'device' array (use $arrayElemAt to get first)
          groupId.floor = '$device.location.floor';
          break;
        case 'room':
          groupId.room = '$device.location.room_name';
          break;
        case 'building':
          groupId.building = '$device.location.building_id';
          break;
        case 'department':
          groupId.department = '$device.metadata.department';
          break;
      }

    // Build aggregation pipeline
    // Using PipelineStage.Match etc. for type safety while allowing dynamic values
    const pipeline: PipelineStage[] = [
      { $match: matchStage } as PipelineStage.Match,
    ];

    // Add $lookup for floor, room, building, department grouping
    if (needsLookup)
      pipeline.push(
        {
          $lookup: {
            from: 'devices_v2',
            localField: 'metadata.device_id',
            foreignField: '_id',
            as: 'device',
          },
        } as PipelineStage.Lookup,
        // Unwind the device array (each reading has exactly one device)
        {
          $unwind: {
            path: '$device',
            preserveNullAndEmptyArrays: false, // Exclude readings without matching device
          },
        } as PipelineStage.Unwind
      );

    pipeline.push(
      { $sort: { timestamp: 1 } } as PipelineStage.Sort,
      {
        $group: {
          _id: groupId,
          value: aggOperator,
          count: { $sum: 1 },
          min_value: { $min: '$value' },
          max_value: { $max: '$value' },
          first_timestamp: { $first: '$timestamp' },
          last_timestamp: { $last: '$timestamp' },
        },
      } as PipelineStage.Group
    );

    // Build projection based on group_by
    const projectStage: Record<string, unknown> = {
      _id: 0,
      time_bucket: '$_id.time_bucket',
      value: { $round: ['$value', 3] },
      count: 1,
      min_value: { $round: ['$min_value', 3] },
      max_value: { $round: ['$max_value', 3] },
      first_timestamp: 1,
      last_timestamp: 1,
    };

    // Add group-specific fields to projection
    if (query.group_by)
      switch (query.group_by) {
        case 'device':
          projectStage.device_id = '$_id.device_id';
          break;
        case 'type':
          projectStage.type = '$_id.type';
          break;
        case 'floor':
          projectStage.floor = '$_id.floor';
          break;
        case 'room':
          projectStage.room = '$_id.room';
          break;
        case 'building':
          projectStage.building = '$_id.building';
          break;
        case 'department':
          projectStage.department = '$_id.department';
          break;
      }

    pipeline.push(
      { $project: projectStage } as PipelineStage.Project,
      { $sort: { time_bucket: 1 } } as PipelineStage.Sort
    );

    // Execute aggregation
    const results = await ReadingV2.aggregate(pipeline);

    // Calculate metadata
    const excludedInvalid = !query.include_invalid;
    let invalidCount = 0;

    if (excludedInvalid) {
      // Count excluded invalid readings
      const invalidMatchStage = { ...matchStage };
      delete invalidMatchStage['quality.is_valid'];
      invalidMatchStage['quality.is_valid'] = false;

      invalidCount = await ReadingV2.countDocuments(invalidMatchStage);
    }

    // Handle comparison period if requested
    let comparisonResults = null;
    let comparisonMetadata = null;

    if (query.compare_with && query.startDate && query.endDate) {
      const comparisonRange = getComparisonDateRange(
        new Date(query.startDate),
        new Date(query.endDate),
        query.compare_with as CompareWithOption
      );

      // Build comparison match stage with the comparison date range
      const comparisonMatchStage: Record<string, unknown> = { ...matchStage };
      comparisonMatchStage.timestamp = {
        $gte: comparisonRange.startDate,
        $lte: comparisonRange.endDate,
      };

      // Build comparison pipeline (same structure, different date range)
      const comparisonPipeline: PipelineStage[] = [
        { $match: comparisonMatchStage } as PipelineStage.Match,
      ];

      if (needsLookup)
        comparisonPipeline.push(
          {
            $lookup: {
              from: 'devices_v2',
              localField: 'metadata.device_id',
              foreignField: '_id',
              as: 'device',
            },
          } as PipelineStage.Lookup,
          {
            $unwind: {
              path: '$device',
              preserveNullAndEmptyArrays: false,
            },
          } as PipelineStage.Unwind
        );

      comparisonPipeline.push(
        { $sort: { timestamp: 1 } } as PipelineStage.Sort,
        {
          $group: {
            _id: groupId,
            value: aggOperator,
            count: { $sum: 1 },
            min_value: { $min: '$value' },
            max_value: { $max: '$value' },
            first_timestamp: { $first: '$timestamp' },
            last_timestamp: { $last: '$timestamp' },
          },
        } as PipelineStage.Group,
        { $project: projectStage } as PipelineStage.Project,
        { $sort: { time_bucket: 1 } } as PipelineStage.Sort
      );

      comparisonResults = await ReadingV2.aggregate(comparisonPipeline);

      // Calculate summary statistics for comparison
      const currentTotal = results.reduce((sum: number, r: { value?: number }) => sum + (r.value || 0), 0);
      const comparisonTotal = comparisonResults.reduce((sum: number, r: { value?: number }) => sum + (r.value || 0), 0);
      const percentageChange = comparisonTotal !== 0
        ? ((currentTotal - comparisonTotal) / comparisonTotal) * 100
        : null;

      comparisonMetadata = {
        label: comparisonRange.label,
        time_range: {
          start: comparisonRange.startDate.toISOString(),
          end: comparisonRange.endDate.toISOString(),
        },
        total_points: comparisonResults.length,
        summary: {
          current_total: Math.round(currentTotal * 1000) / 1000,
          comparison_total: Math.round(comparisonTotal * 1000) / 1000,
          percentage_change: percentageChange !== null
            ? Math.round(percentageChange * 100) / 100
            : null,
          trend: percentageChange === null
            ? 'no_data'
            : percentageChange > 0
              ? 'increase'
              : percentageChange < 0
                ? 'decrease'
                : 'stable',
        },
      };
    }

    return jsonSuccess({
      results,
      comparison: comparisonResults ? {
        results: comparisonResults,
        ...comparisonMetadata,
      } : null,
      metadata: {
        granularity: query.granularity || 'hour',
        aggregation_type: query.aggregation || 'avg',
        total_points: results.length,
        excluded_invalid: invalidCount,
        group_by: query.group_by || null,
        time_range: {
          start: query.startDate,
          end: query.endDate,
        },
        compare_with: query.compare_with || null,
      },
    });
  })();
}
