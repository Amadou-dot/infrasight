import { Types } from 'mongoose';
import { z } from 'zod';
import { InvalidAnomalyResultError, readAnomalies } from '@/lib/analytics/anomalies';
import { readHealth } from '@/lib/analytics/health';
import { readActiveDeviceIds, readDevice, readDevices } from '@/lib/data/device-reads';
import type { ReadContext, Snapshot } from '@/lib/data/read-context';
import { readReadings } from '@/lib/data/reading-reads';
import type { IDeviceV2 } from '@/models/v2/DeviceV2';
import type { IReadingV2 } from '@/models/v2/ReadingV2';
import {
  type Args,
  type ToolData,
  type ToolName,
  type WindowBounds,
  outputSchemas,
  ToolError,
} from './contracts';

const deviceFields = [
  '_id',
  'serial_number',
  'location.building_id',
  'location.floor',
  'location.room_name',
  'type',
  'status',
];
const deviceDetailFields = [
  ...deviceFields,
  'health.last_seen',
  'health.battery_level',
  'health.uptime_percentage',
  'health.error_count',
];
const readingFields = [
  '_id',
  'timestamp',
  'value',
  'metadata.device_id',
  'metadata.type',
  'metadata.unit',
  'metadata.source',
  'quality.is_valid',
  'quality.is_anomaly',
  'quality.anomaly_score',
  'quality.confidence_score',
];

const utcTimestamp = z.iso.datetime();

function timestamp(value: unknown) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : value;
}

function assertResult(condition: unknown): asserts condition {
  if (!condition) throw new ToolError('INVALID_RESULT');
}

function projectSnapshot<T, N extends ToolName>(
  name: N,
  snapshot: Snapshot<T>,
  project: (data: T) => unknown
): Snapshot<ToolData<N>> {
  let projected: unknown;
  try {
    projected = project(snapshot.data);
  } catch {
    throw new ToolError('INVALID_RESULT');
  }
  const parsed = outputSchemas[name].safeParse(projected);
  assertResult(parsed.success);
  const { computedAt, retrievedAt } = snapshot;
  assertResult(computedAt === null || utcTimestamp.safeParse(computedAt).success);
  assertResult(utcTimestamp.safeParse(retrievedAt).success);
  return { data: parsed.data as ToolData<N>, computedAt, retrievedAt };
}

async function read<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InvalidAnomalyResultError) throw new ToolError('INVALID_RESULT');
    throw new ToolError('READ_UNAVAILABLE');
  }
}

async function requireActiveDevices(context: ReadContext, ids: readonly string[]) {
  const rows = await read(() => readActiveDeviceIds(context, ids));
  const found = new Set(rows.map(row => row._id));
  if (!ids.every(id => found.has(id))) throw new ToolError('DEVICE_UNAVAILABLE');
}

function firstPage<T, Row>(probed: T[], total: number, limit: number, project: (raw: T) => Row) {
  // The extra row distinguishes a complete first page from a stale independent count.
  assertResult(probed.length === Math.min(total, limit + 1));
  const rows = probed.slice(0, limit).map(project);
  return { rows, total, returned: rows.length, truncated: rows.length < total };
}

function projectDevice(
  raw: Pick<IDeviceV2, '_id' | 'serial_number' | 'type' | 'location' | 'status'>
) {
  return {
    id: raw._id,
    serial_number: raw.serial_number,
    type: raw.type,
    building_id: raw.location?.building_id,
    floor: raw.location?.floor,
    room_name: raw.location?.room_name,
    status: raw.status,
  };
}

function projectReading(
  raw: Pick<IReadingV2, 'value' | 'metadata' | 'quality'> & { _id: unknown; timestamp: unknown }
) {
  return {
    id: raw._id instanceof Types.ObjectId ? raw._id.toHexString() : raw._id,
    device_id: raw.metadata?.device_id,
    timestamp: timestamp(raw.timestamp),
    value: raw.value,
    type: raw.metadata?.type,
    unit: raw.metadata?.unit,
    source: raw.metadata?.source,
    is_valid: raw.quality?.is_valid,
    is_anomaly: raw.quality?.is_anomaly,
    anomaly_score: raw.quality?.anomaly_score ?? null,
    confidence_score: raw.quality?.confidence_score ?? null,
  };
}

function withinWindow(value: string, { start, end }: WindowBounds) {
  const instant = Date.parse(value);
  return instant >= Date.parse(start) && instant <= Date.parse(end);
}

export const readPorts = {
  async find_devices(
    context: ReadContext,
    args: Args<'find_devices'>
  ): Promise<Snapshot<ToolData<'find_devices'>>> {
    const snapshot = await read(() =>
      readDevices(context, {
        search: args.search ?? undefined,
        building_id: args.building_id ?? undefined,
        floor: args.floor ?? undefined,
        type: args.type ?? undefined,
        page: 1,
        limit: args.limit + 1,
        sortBy: 'serial_number',
        sortDirection: 'asc',
        include_deleted: false,
        only_deleted: false,
        offline_threshold_minutes: 5,
        fields: deviceFields,
      })
    );
    const projected = projectSnapshot('find_devices', snapshot, data =>
      firstPage(data.devices, data.paginationInfo.total, args.limit, projectDevice)
    );
    assertResult(
      projected.data.rows.every(
        row =>
          (args.building_id === null || row.building_id === args.building_id) &&
          (args.floor === null || row.floor === args.floor) &&
          (args.type === null || row.type === args.type)
      )
    );
    return projected;
  },

  async get_health_summary(
    context: ReadContext,
    args: Args<'get_health_summary'>
  ): Promise<Snapshot<ToolData<'get_health_summary'>>> {
    const snapshot = await read(() =>
      readHealth(context, {
        building_id: args.building_id ?? undefined,
        floor: args.floor ?? undefined,
        offline_threshold_minutes: 5,
        battery_warning_threshold: 20,
      })
    );
    return projectSnapshot('get_health_summary', snapshot, data => {
      assertResult(
        data.filters_applied.building_id === args.building_id &&
          data.filters_applied.floor === args.floor &&
          data.filters_applied.department === null
      );
      const { offline_devices, low_battery_devices, error_devices, devices_with_issues } =
        data.alerts;
      return {
        total_devices: data.summary.total_devices,
        active_devices: data.summary.active_devices,
        health_score: data.summary.health_score,
        devices_with_issues: devices_with_issues.count,
        offline: {
          count: offline_devices.count,
          threshold_minutes: offline_devices.threshold_minutes,
          sample: offline_devices.devices.map(row => ({
            id: row._id,
            last_seen: row.health?.last_seen,
          })),
        },
        low_battery: {
          count: low_battery_devices.count,
          threshold_percent: low_battery_devices.threshold_percent,
          sample: low_battery_devices.devices.map(row => ({
            id: row._id,
            battery_level: row.health?.battery_level,
          })),
        },
        error: {
          count: error_devices.count,
          sample: error_devices.devices.map(row => ({
            id: row._id,
            error_count: row.health?.error_count,
          })),
        },
      };
    });
  },

  async get_anomalies(
    context: ReadContext,
    args: Args<'get_anomalies'> & WindowBounds
  ): Promise<Snapshot<ToolData<'get_anomalies'>>> {
    const selected = args.device_ids;
    const ids = selected === null ? null : new Set(selected);
    const deviceIds = ids === null ? undefined : [...ids];
    if (deviceIds) {
      if (deviceIds.length === 0 || deviceIds.length !== selected?.length)
        throw new ToolError('INVALID_ARGUMENTS');
      await requireActiveDevices(context, deviceIds);
    }
    const snapshot = await read(() =>
      readAnomalies(
        context,
        {
          device_id: deviceIds,
          startDate: new Date(args.start),
          endDate: new Date(args.end),
          min_score: args.min_score ?? undefined,
          page: 1,
          limit: args.limit + 1,
          sortBy: 'timestamp',
          sortDirection: 'desc',
        },
        { fields: readingFields, tieBreakById: true, includeTypeBreakdown: false }
      )
    );
    if (deviceIds) await requireActiveDevices(context, deviceIds);
    const projected = projectSnapshot('get_anomalies', snapshot, data => ({
      ...firstPage(data.anomalies, data.summary.total_anomalies, args.limit, projectReading),
      by_device: data.summary.by_device.map(row => {
        const latest = utcTimestamp.safeParse(row.latest_timestamp);
        assertResult(latest.success && withinWindow(latest.data, args));
        return { device_id: row.device_id, count: row.count, avg_score: row.avg_score };
      }),
      breakdown_limit: 10,
      includes_invalid: true,
      includes_deleted_or_missing_devices: ids === null,
    }));
    assertResult(
      projected.data.rows.every(
        row =>
          (!ids || ids.has(row.device_id)) &&
          withinWindow(row.timestamp, args) &&
          (args.min_score === null ||
            (row.anomaly_score !== null && row.anomaly_score >= args.min_score))
      )
    );
    assertResult(!ids || projected.data.by_device.every(row => ids.has(row.device_id)));
    return projected;
  },

  async get_device(
    context: ReadContext,
    args: Args<'get_device'>
  ): Promise<Snapshot<ToolData<'get_device'>>> {
    const computedAt = new Date().toISOString();
    const data = await read(() =>
      readDevice(context, args.device_id, {
        fields: deviceDetailFields,
        include_recent_readings: false,
        readings_limit: 10,
      })
    );
    if (!data) throw new ToolError('DEVICE_UNAVAILABLE');
    const projected = projectSnapshot(
      'get_device',
      {
        data,
        computedAt,
        retrievedAt: new Date().toISOString(),
      },
      row => ({
        ...projectDevice(row),
        last_seen: timestamp(row.health?.last_seen ?? null),
        battery_level: row.health?.battery_level ?? null,
        uptime_percentage: row.health?.uptime_percentage ?? null,
        error_count: row.health?.error_count,
      })
    );
    assertResult(projected.data.id === args.device_id);
    return projected;
  },

  async get_readings_window(
    context: ReadContext,
    args: Args<'get_readings_window'>
  ): Promise<Snapshot<ToolData<'get_readings_window'>>> {
    const computedAt = new Date().toISOString();
    await requireActiveDevices(context, [args.device_id]);
    const data = await read(() =>
      readReadings(
        context,
        {
          device_id: args.device_id,
          startDate: new Date(args.start),
          endDate: new Date(args.end),
          page: 1,
          limit: args.limit + 1,
          sortBy: 'timestamp',
          sortDirection: 'asc',
          fields: readingFields,
        },
        { tieBreakById: true }
      )
    );
    await requireActiveDevices(context, [args.device_id]);
    const projected = projectSnapshot(
      'get_readings_window',
      {
        data,
        computedAt,
        retrievedAt: new Date().toISOString(),
      },
      result => firstPage(result.readings, result.paginationInfo.total, args.limit, projectReading)
    );
    assertResult(
      projected.data.rows.every(
        row => row.device_id === args.device_id && withinWindow(row.timestamp, args)
      )
    );
    return projected;
  },
};
