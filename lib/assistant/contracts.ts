import { z } from 'zod';
import {
  anomalyScoreSchema,
  batteryLevelSchema,
  buildingIdSchema,
  confidenceScoreSchema,
  deviceIdSchema,
  floorSchema,
  roomNameSchema,
  serialNumberSchema,
} from '@/lib/validations/common.validation';
import { sanitizeForRegex, sanitizeSearchQuery } from '@/lib/validations/sanitizer';
import { deviceStatusSchema, deviceTypeSchema } from '@/lib/validations/v2/device.validation';
import {
  readingSourceSchema,
  readingTypeSchema,
  readingUnitSchema,
} from '@/lib/validations/v2/reading.validation';

const MAX_ARGUMENT_BYTES = 4096;
const MAX_ROWS = 20;
const MAX_HEALTH_SAMPLE = 10;
const ANOMALY_BREAKDOWN_LIMIT = 10;
const MS_PER_HOUR = 3_600_000;
const RETENTION_HOURS = 168;
const DEFAULT_ANOMALY_HOURS = 24;

const utcTimestamp = z.iso
  .datetime()
  .refine(timestamp => !/\.\d{3}\d*[1-9]/.test(timestamp), 'Use millisecond precision or coarser');
const rowLimit = z.int().min(1).max(MAX_ROWS);

function stripControlCharacters(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

const deviceSearch = z
  .string()
  .min(1)
  .max(80)
  .transform(search => search.trim().replace(/\s+/g, ' '))
  .refine(
    search =>
      search.length > 0 &&
      search === stripControlCharacters(search) &&
      sanitizeSearchQuery(search) === sanitizeForRegex(search),
    'Search must preserve its literal meaning in the device reader'
  );

// The model supplies each field, using null for optional filters.
export const inputs = {
  find_devices: z.strictObject({
    search: deviceSearch.nullable(),
    building_id: buildingIdSchema.nullable(),
    floor: floorSchema.nullable(),
    type: deviceTypeSchema.nullable(),
    limit: rowLimit,
  }),
  get_health_summary: z.strictObject({
    building_id: buildingIdSchema.nullable(),
    floor: floorSchema.nullable(),
  }),
  get_anomalies: z
    .strictObject({
      device_ids: z
        .array(deviceIdSchema)
        .min(1)
        .max(MAX_ROWS)
        .refine(ids => new Set(ids).size === ids.length, 'Device IDs must be unique')
        .nullable(),
      start: utcTimestamp.nullable(),
      end: utcTimestamp.nullable(),
      min_score: anomalyScoreSchema.nullable(),
      limit: rowLimit,
    })
    .refine(({ start, end }) => (start === null) === (end === null), {
      message: 'Supply both window bounds or null for both',
    }),
  get_device: z.strictObject({ device_id: deviceIdSchema }),
  get_readings_window: z.strictObject({
    device_id: deviceIdSchema,
    start: utcTimestamp,
    end: utcTimestamp,
    limit: rowLimit,
  }),
};

export type ToolName = keyof typeof inputs;
export type Args<N extends ToolName> = z.infer<(typeof inputs)[N]>;

const descriptions: Record<ToolName, string> = {
  find_devices:
    'Search serial number, room name, or tags. Use get_device for an exact device ID. Returns page 1, which may cover only part of the matching cohort.',
  get_health_summary:
    'Read health counts for current undeleted devices. The health score is the rounded percentage with stored active status. Offline and low-battery thresholds are 5 minutes and 20 percent.',
  get_anomalies:
    'Read stored anomaly flags, which may include invalid readings. Null dates select the last 24 hours. ' +
    'Otherwise supply both UTC dates within the last 7 days at millisecond precision or coarser. ' +
    'Null device_ids selects the approved dataset and may include readings from deleted or missing devices. ' +
    'For a building, floor, or filtered group, call find_devices with limit 20 and pass the complete list of unique IDs. ' +
    'If a filtered group is empty, report no matching devices. An empty unfiltered inventory still permits a dataset anomaly read. If a filtered search is incomplete, ask to narrow the scope.',
  get_device:
    'Read identity, location, status, and numeric health for one current undeleted device.',
  get_readings_window:
    'Read up to 20 timestamp-ascending readings for one current device. Supply both UTC window bounds within the last 7 days at millisecond precision or coarser. The window may span up to 24 hours and the result may be a partial sample.',
};

export const TOOLS = (Object.keys(inputs) as ToolName[]).map(name => {
  const { $schema: _dialect, ...parameters } = z.toJSONSchema(inputs[name], { io: 'input' });
  return {
    type: 'function',
    name,
    description: descriptions[name],
    strict: true,
    parameters,
  } as const;
});

export type ToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_ARGUMENTS'
  | 'OUTSIDE_RETENTION'
  | 'RANGE_TOO_WIDE'
  | 'INVALID_RESULT'
  | 'DEVICE_UNAVAILABLE'
  | 'SCOPE_TOO_LARGE'
  | 'INCOMPLETE_COHORT'
  | 'RESULT_TOO_LARGE'
  | 'TOOL_TIMEOUT'
  | 'READ_UNAVAILABLE'
  | 'TOOL_LIMIT';

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode) {
    super(code);
    this.name = 'ToolError';
  }
}

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(inputs, name);
}

export function parseToolArgs<N extends ToolName>(name: N, json: string): Args<N>;
export function parseToolArgs(name: string, json: string): Args<ToolName>;
export function parseToolArgs(name: string, json: string): Args<ToolName> {
  if (!isToolName(name)) throw new ToolError('UNKNOWN_TOOL');
  if (Buffer.byteLength(json, 'utf8') > MAX_ARGUMENT_BYTES)
    throw new ToolError('INVALID_ARGUMENTS');

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ToolError('INVALID_ARGUMENTS');
  }

  const result = inputs[name].safeParse(raw);
  if (!result.success) throw new ToolError('INVALID_ARGUMENTS');
  return result.data;
}

export interface WindowBounds {
  start: string;
  end: string;
}

export function resolveWindow(
  start: string | null,
  end: string | null,
  asOf: string,
  maxHours: number
): WindowBounds {
  if (!utcTimestamp.safeParse(asOf).success || !Number.isFinite(maxHours) || maxHours <= 0)
    throw new ToolError('READ_UNAVAILABLE');

  const now = Date.parse(asOf);
  let begin = now - DEFAULT_ANOMALY_HOURS * MS_PER_HOUR;
  let finish = now;
  if (start !== null || end !== null) {
    if (
      start === null ||
      end === null ||
      !utcTimestamp.safeParse(start).success ||
      !utcTimestamp.safeParse(end).success
    )
      throw new ToolError('INVALID_ARGUMENTS');
    begin = Date.parse(start);
    finish = Date.parse(end);
  }

  if (!Number.isFinite(begin) || !Number.isFinite(finish) || begin >= finish || finish > now)
    throw new ToolError('INVALID_ARGUMENTS');
  if (begin < now - RETENTION_HOURS * MS_PER_HOUR) throw new ToolError('OUTSIDE_RETENTION');
  if (finish - begin > maxHours * MS_PER_HOUR) throw new ToolError('RANGE_TOO_WIDE');

  return { start: new Date(begin).toISOString(), end: new Date(finish).toISOString() };
}

const count = z.int().nonnegative();

function sampleFitsCount(category: { count: number; sample: unknown[] }): boolean {
  return category.sample.length <= category.count;
}

function pageFields<Row extends z.ZodType>(row: Row) {
  return {
    rows: z.array(row).max(MAX_ROWS),
    total: count,
    returned: count.max(MAX_ROWS),
    truncated: z.boolean(),
  };
}

function pageIsConsistent(data: {
  rows: unknown[];
  total: number;
  returned: number;
  truncated: boolean;
}): boolean {
  return (
    data.returned === data.rows.length &&
    data.returned <= data.total &&
    data.truncated === data.returned < data.total
  );
}

const roomLabel = z
  .string()
  .transform(stripControlCharacters)
  .pipe(roomNameSchema.refine(name => name.trim().length > 0, 'Room label cannot be blank'));

const deviceSummary = z.strictObject({
  id: deviceIdSchema,
  serial_number: serialNumberSchema,
  type: deviceTypeSchema,
  building_id: buildingIdSchema,
  floor: floorSchema,
  room_name: roomLabel,
  status: deviceStatusSchema,
});

const reading = z.strictObject({
  id: deviceIdSchema,
  device_id: deviceIdSchema,
  timestamp: utcTimestamp,
  value: z.number(),
  type: readingTypeSchema,
  unit: readingUnitSchema,
  source: readingSourceSchema,
  is_valid: z.boolean(),
  is_anomaly: z.boolean(),
  anomaly_score: anomalyScoreSchema.nullable(),
  confidence_score: confidenceScoreSchema.nullable(),
});

export const outputSchemas = {
  find_devices: z.strictObject(pageFields(deviceSummary)).refine(pageIsConsistent),
  get_health_summary: z.strictObject({
    total_devices: count,
    active_devices: count,
    health_score: z.int().min(0).max(100),
    devices_with_issues: count,
    offline: z
      .strictObject({
        count,
        threshold_minutes: z.literal(5),
        sample: z
          .array(z.strictObject({ id: deviceIdSchema, last_seen: utcTimestamp }))
          .max(MAX_HEALTH_SAMPLE),
      })
      .refine(sampleFitsCount),
    low_battery: z
      .strictObject({
        count,
        threshold_percent: z.literal(20),
        sample: z
          .array(z.strictObject({ id: deviceIdSchema, battery_level: batteryLevelSchema }))
          .max(MAX_HEALTH_SAMPLE),
      })
      .refine(sampleFitsCount),
    error: z
      .strictObject({
        count,
        sample: z
          .array(z.strictObject({ id: deviceIdSchema, error_count: count }))
          .max(MAX_HEALTH_SAMPLE),
      })
      .refine(sampleFitsCount),
  }),
  get_anomalies: z
    .strictObject({
      ...pageFields(reading),
      by_device: z
        .array(
          z.strictObject({
            device_id: deviceIdSchema,
            count: z.int().positive(),
            // MongoDB returns null when all matching flagged readings lack scores.
            avg_score: anomalyScoreSchema.nullable(),
          })
        )
        .max(ANOMALY_BREAKDOWN_LIMIT),
      breakdown_limit: z.literal(ANOMALY_BREAKDOWN_LIMIT),
      includes_invalid: z.literal(true),
      includes_deleted_or_missing_devices: z.boolean(),
    })
    .refine(pageIsConsistent)
    .refine(({ by_device, total }) => by_device.reduce((sum, row) => sum + row.count, 0) <= total)
    .refine(({ rows }) => rows.every(row => row.is_anomaly)),
  get_device: deviceSummary.extend({
    last_seen: utcTimestamp.nullable(),
    battery_level: batteryLevelSchema.nullable(),
    uptime_percentage: batteryLevelSchema.nullable(),
    error_count: count,
  }),
  get_readings_window: z.strictObject(pageFields(reading)).refine(pageIsConsistent),
} satisfies Record<ToolName, z.ZodType>;

export type ToolData<N extends ToolName> = z.infer<(typeof outputSchemas)[N]>;
