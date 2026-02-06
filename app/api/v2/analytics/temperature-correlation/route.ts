/**
 * V2 Temperature Correlation API Route
 *
 * GET /api/v2/analytics/temperature-correlation - Temperature correlation analysis
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';
import { handleError, ApiError, ErrorCodes } from '@/lib/errors';
import { jsonSuccess } from '@/lib/api/response';
import { requireOrgMembership } from '@/lib/auth';
import { z } from 'zod';
import { validateQuery } from '@/lib/validations/validator';
import {
  calculatePearsonCorrelation,
  diagnoseTemperature,
  getDiagnosisExplanation,
} from '@/lib/utils/correlation';

// ============================================================================
// Query Schema
// ============================================================================

const temperatureCorrelationQuerySchema = z.object({
  device_id: z.string().min(1, 'device_id is required'),
  hours: z
    .union([z.number(), z.string().transform(v => parseInt(v, 10))])
    .default(24)
    .refine(v => v > 0 && v <= 168, 'hours must be between 1 and 168 (7 days)'),
  device_temp_threshold: z
    .union([z.number(), z.string().transform(v => parseFloat(v))])
    .default(80),
  ambient_temp_threshold: z
    .union([z.number(), z.string().transform(v => parseFloat(v))])
    .default(30),
});

type TemperatureCorrelationQuery = z.infer<typeof temperatureCorrelationQuerySchema>;

// ============================================================================
// GET /api/v2/analytics/temperature-correlation
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Require org membership for read access
    await requireOrgMembership();

    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, temperatureCorrelationQuerySchema);
    if (!validationResult.success)
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );

    const query = validationResult.data as TemperatureCorrelationQuery;

    // Verify device exists
    const device = await DeviceV2.findById(query.device_id).lean();
    if (!device)
      throw new ApiError(
        ErrorCodes.DEVICE_NOT_FOUND,
        404,
        `Device with ID '${query.device_id}' not found`
      );

    // Calculate time range
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - query.hours * 60 * 60 * 1000);

    // Fetch temperature readings for this device
    const readings = await ReadingV2.find({
      'metadata.device_id': query.device_id,
      'metadata.type': 'temperature',
      timestamp: { $gte: startTime, $lte: endTime },
    })
      .sort({ timestamp: 1 })
      .lean();

    // Check if we have sufficient data
    if (readings.length === 0)
      return jsonSuccess({
        device_id: query.device_id,
        device_temp_series: [],
        ambient_temp_series: [],
        correlation_score: null,
        diagnosis: 'normal',
        diagnosis_explanation:
          'Insufficient data: No temperature readings found for this device in the specified time range.',
        threshold_breaches: [],
        data_points: 0,
        time_range: {
          start: startTime.toISOString(),
          end: endTime.toISOString(),
        },
      });

    // Extract device temperatures and ambient temperatures
    const deviceTempSeries: Array<{ timestamp: string; value: number }> = [];
    const ambientTempSeries: Array<{ timestamp: string; value: number }> = [];
    const deviceTemps: number[] = [];
    const ambientTemps: number[] = [];
    const thresholdBreaches: Array<{
      timestamp: string;
      device_temp: number;
      ambient_temp: number;
    }> = [];

    for (const reading of readings) {
      const timestamp = reading.timestamp.toISOString();
      const deviceTemp = reading.value;
      const ambientTemp = reading.context?.ambient_temp;

      // Add device temperature
      deviceTempSeries.push({ timestamp, value: deviceTemp });
      deviceTemps.push(deviceTemp);

      // Add ambient temperature if available
      if (ambientTemp !== undefined) {
        ambientTempSeries.push({ timestamp, value: ambientTemp });
        ambientTemps.push(ambientTemp);

        // Check for threshold breaches
        if (deviceTemp > query.device_temp_threshold || ambientTemp > query.ambient_temp_threshold)
          thresholdBreaches.push({
            timestamp,
            device_temp: deviceTemp,
            ambient_temp: ambientTemp,
          });
      }
    }

    // Calculate correlation if we have both series
    const correlationScore =
      ambientTemps.length > 1 ? calculatePearsonCorrelation(deviceTemps, ambientTemps) : null;

    // Get current temperatures for diagnosis
    const latestReading = readings[readings.length - 1];
    const currentDeviceTemp = latestReading.value;
    const currentAmbientTemp = latestReading.context?.ambient_temp;

    // Diagnose temperature issue
    let diagnosis: 'device_failure' | 'environmental' | 'normal' = 'normal';
    let diagnosisExplanation = 'Insufficient ambient temperature data for diagnosis.';

    if (currentAmbientTemp !== undefined) {
      diagnosis = diagnoseTemperature(
        currentDeviceTemp,
        currentAmbientTemp,
        query.device_temp_threshold,
        query.ambient_temp_threshold
      );
      diagnosisExplanation = getDiagnosisExplanation(
        diagnosis,
        currentDeviceTemp,
        currentAmbientTemp
      );
    }

    const response = {
      device_id: query.device_id,
      device_temp_series: deviceTempSeries,
      ambient_temp_series: ambientTempSeries,
      correlation_score: correlationScore,
      diagnosis,
      diagnosis_explanation: diagnosisExplanation,
      threshold_breaches: thresholdBreaches,
      data_points: readings.length,
      ambient_data_points: ambientTemps.length,
      time_range: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
      },
      current_readings: {
        device_temp: currentDeviceTemp,
        ambient_temp: currentAmbientTemp || null,
        timestamp: latestReading.timestamp.toISOString(),
      },
    };

    return jsonSuccess(response);
  } catch (error) {
    const { error: apiError } = handleError(error);
    return apiError.toResponse();
  }
}
