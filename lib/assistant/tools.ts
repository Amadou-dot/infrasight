import { createReadContext } from '@/lib/data/read-context';
import { ApiError } from '@/lib/errors';
import { requireAssistantContext, reauthorizeAssistant } from './access';
import { isToolName, parseToolArgs, resolveWindow, ToolError } from './contracts';
import {
  readEvidence,
  readingLimitations,
  searchPopulation,
  type AnyExecutedRead,
  type ExecutedRead,
  type Population,
  type SearchResolution,
} from './evidence';
import { readPorts } from './read-ports';

const MAX_ATTEMPTS = 6;
const MAX_RESULT_BYTES = 6 * 1024;
const MAX_QUESTION_BYTES = 24 * 1024;
const TOOL_DEADLINE_MS = 8_000;

type Selection = { resolution: SearchResolution; ids: string[] } | 'unresolved' | null;

function rememberSearch(read: ExecutedRead<'find_devices'>): Selection {
  const { data, computedAt, retrievedAt } = read.snapshot;
  const ids = data.rows.map(row => row.id).sort();
  if (new Set(ids).size !== ids.length) throw new ToolError('INVALID_RESULT');
  return {
    ids,
    resolution: Object.freeze({
      filters: Object.freeze({ ...read.filters }),
      total: data.total,
      computedAt,
      retrievedAt,
    }),
  };
}

function anomalyPopulation(
  selection: Selection,
  ids: string[] | null
): {
  population: Population;
  resolution?: SearchResolution;
} {
  const explicit: Population =
    ids === null ? { kind: 'dataset' } : { kind: 'device_subset', device_ids: ids };
  if (selection === null) return { population: explicit };
  if (selection === 'unresolved') {
    if (ids === null) throw new ToolError('INCOMPLETE_COHORT');
    return { population: explicit };
  }
  const { resolution } = selection;
  const population = searchPopulation(resolution.filters);
  if (ids === null && resolution.total === 0)
    // Even an empty list of current devices says nothing about orphaned readings.
    return {
      population:
        population.kind === 'dataset' ? { kind: 'device_subset', device_ids: [] } : population,
      resolution,
    };

  if (population.kind === 'dataset') return { population: explicit };
  const sameIds =
    ids !== null &&
    ids.length === selection.ids.length &&
    ids.every((id, i) => id === selection.ids[i]);
  if (ids !== null && !sameIds) return { population: explicit };
  if (resolution.total > 20) throw new ToolError('SCOPE_TOO_LARGE');
  if (resolution.total !== selection.ids.length) throw new ToolError('INCOMPLETE_COHORT');
  // A scoped search must supply its verified IDs before a nonempty anomaly query.
  if (ids === null) throw new ToolError('INVALID_ARGUMENTS');
  return { population, resolution };
}

async function untilAborted<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work(), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** One server-owned tool session per question. The browser and model only supply tool arguments. */
export async function createAssistantTools() {
  const scope = await requireAssistantContext();
  let selection: Selection = null;
  let accessFailure: ApiError | undefined;
  let attempts = 0;
  let bytesReturned = 0;
  let previous = Promise.resolve();

  async function authorize(signal: AbortSignal) {
    signal.throwIfAborted();
    if (accessFailure) throw accessFailure;
    try {
      await reauthorizeAssistant(scope);
    } catch (error) {
      signal.throwIfAborted();
      selection = null;
      accessFailure =
        error instanceof ApiError
          ? error
          : ApiError.serviceUnavailable('Assistant access is unavailable');
      throw accessFailure;
    }
    signal.throwIfAborted();
  }

  async function context(signal: AbortSignal) {
    const current = await createReadContext(scope.orgId, signal);
    signal.throwIfAborted();
    if (current.datasetId !== scope.datasetId || current.orgId !== scope.orgId) {
      selection = null;
      accessFailure = ApiError.forbidden('Assistant dataset access changed');
      throw accessFailure;
    }
    return current;
  }

  async function dispatch(
    name: string,
    json: string,
    signal: AbortSignal
  ): Promise<AnyExecutedRead> {
    if (!isToolName(name)) throw new ToolError('UNKNOWN_TOOL');
    switch (name) {
      case 'find_devices': {
        const args = parseToolArgs(name, json);
        const result = await readPorts.find_devices(await context(signal), args);
        const warnings = result.data.truncated ? ['DEVICE_LIST_PARTIAL'] : [];
        if (result.data.total === 0) warnings.push('EMPTY_COHORT');
        return readEvidence(name, args, searchPopulation(args), result, warnings);
      }
      case 'get_health_summary': {
        const args = parseToolArgs(name, json);
        const population = searchPopulation({ ...args, search: null, type: null });
        if (population.kind === 'location') {
          const prior =
            selection && selection !== 'unresolved' ? selection.resolution.filters : null;
          if (
            !prior ||
            prior.building_id !== args.building_id ||
            prior.floor !== args.floor ||
            prior.type !== null ||
            prior.search !== null
          )
            selection = 'unresolved';
        }
        const result = await readPorts.get_health_summary(await context(signal), args);
        const warnings = [
          'HEALTH_SCORE_IS_STATUS_RATIO',
          'HEALTH_CATEGORY_COUNTS_OVERLAP',
          'HEALTH_DEVICE_LISTS_ARE_SAMPLES',
        ];
        if (result.data.total_devices === 0) warnings.push('EMPTY_COHORT');
        return readEvidence(
          name,
          { ...args, offline_threshold_minutes: 5, battery_warning_threshold: 20 },
          population,
          result,
          warnings
        );
      }
      case 'get_anomalies': {
        const args = parseToolArgs(name, json);
        const window = resolveWindow(args.start, args.end, scope.asOf, 168);
        const ids = args.device_ids === null ? null : [...args.device_ids].sort();
        const { population, resolution } = anomalyPopulation(selection, ids);
        if (resolution?.total === 0) {
          const empty = {
            rows: [],
            total: 0,
            returned: 0,
            truncated: false,
            by_device: [],
            breakdown_limit: 10 as const,
            includes_invalid: true as const,
            includes_deleted_or_missing_devices: false,
          };
          return readEvidence(
            name,
            { ...args, ...window, device_ids: [] },
            population,
            {
              data: empty,
              computedAt: resolution.computedAt,
              retrievedAt: resolution.retrievedAt,
            },
            ['EMPTY_COHORT', 'COHORT_AS_OF_DEVICE_SEARCH', ...readingLimitations(empty, true)],
            resolution
          );
        }
        const filters = { ...args, ...window, device_ids: ids };
        const result = await readPorts.get_anomalies(await context(signal), filters);
        if (result.data.includes_deleted_or_missing_devices !== (ids === null))
          throw new ToolError('INVALID_RESULT');
        const warnings = readingLimitations(result.data, true);
        if (ids === null) warnings.push('ANOMALY_SCOPE_MAY_INCLUDE_DELETED_OR_MISSING_DEVICES');
        if (resolution) warnings.push('COHORT_AS_OF_DEVICE_SEARCH');
        return readEvidence(name, filters, population, result, warnings, resolution);
      }
      case 'get_device': {
        const args = parseToolArgs(name, json);
        const result = await readPorts.get_device(await context(signal), args);
        return readEvidence(name, args, { kind: 'device', device_id: args.device_id }, result, []);
      }
      case 'get_readings_window': {
        const args = parseToolArgs(name, json);
        const filters = { ...args, ...resolveWindow(args.start, args.end, scope.asOf, 24) };
        const result = await readPorts.get_readings_window(await context(signal), filters);
        return readEvidence(
          name,
          filters,
          { kind: 'device', device_id: args.device_id },
          result,
          readingLimitations(result.data, false)
        );
      }
    }
  }

  async function executeReadTool(name: string, json: string, callerSignal: AbortSignal) {
    if (accessFailure) throw accessFailure;
    if (++attempts > MAX_ATTEMPTS) throw new ToolError('TOOL_LIMIT');
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(TOOL_DEADLINE_MS)]);
    const preceding = previous;
    const pending = untilAborted(signal, async () => {
      await preceding;
      await authorize(signal);
      const read = await dispatch(name, json, signal);
      // Ignore late work after cancellation or a change in access, including on cache hits.
      await authorize(signal);
      const bytes = Buffer.byteLength(JSON.stringify(read), 'utf8');
      if (bytes > MAX_RESULT_BYTES || bytes + bytesReturned > MAX_QUESTION_BYTES)
        throw new ToolError('RESULT_TOO_LARGE');
      if (read.name === 'find_devices') selection = rememberSearch(read);
      bytesReturned += bytes;
      return read;
    });
    // A queued cancellation settles immediately for its caller. Update scope in submission order,
    // including when a location request failed before it reached the database.
    previous = Promise.allSettled([preceding, pending]).then(([, result]) => {
      if (
        result.status === 'rejected' &&
        (name === 'find_devices' || name === 'get_health_summary')
      )
        selection = 'unresolved';
    });
    try {
      return await pending;
    } catch (error) {
      if (callerSignal.aborted) throw new DOMException('Assistant request cancelled', 'AbortError');
      if (signal.aborted) throw new ToolError('TOOL_TIMEOUT');
      if (accessFailure) throw accessFailure;
      if (error instanceof ToolError) throw error;
      throw new ToolError('READ_UNAVAILABLE');
    }
  }

  return { scope, executeReadTool };
}
