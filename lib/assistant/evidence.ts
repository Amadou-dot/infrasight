import { z } from 'zod';
import { CACHE_TTL } from '@/lib/cache';
import type { Snapshot } from '@/lib/data/read-context';
import { ToolError, type Args, type ToolData, type ToolName, type WindowBounds } from './contracts';

type Search = Args<'find_devices'>;
type Location = Args<'get_health_summary'>;

export type Population =
  | { kind: 'dataset' }
  | ({ kind: 'location' } & Location)
  | ({ kind: 'filtered_devices' } & Omit<Search, 'limit'>)
  | { kind: 'device_subset'; device_ids: string[] }
  | { kind: 'device'; device_id: string };

export interface SearchResolution {
  filters: Search;
  total: number;
  computedAt: string | null;
  retrievedAt: string;
}

export type EvidenceFilters = {
  find_devices: Search;
  get_health_summary: Location & { offline_threshold_minutes: 5; battery_warning_threshold: 20 };
  get_anomalies: Args<'get_anomalies'> & WindowBounds;
  get_device: Args<'get_device'>;
  get_readings_window: Args<'get_readings_window'>;
};

export interface ExecutedRead<N extends ToolName> {
  name: N;
  route: string;
  href: string;
  filters: EvidenceFilters[N];
  population: Population;
  snapshot: Snapshot<ToolData<N>>;
  limitations: string[];
  resolution?: SearchResolution;
}

export type AnyExecutedRead = { [N in ToolName]: ExecutedRead<N> }[ToolName];

export function searchPopulation({
  search,
  type,
  building_id,
  floor,
}: Omit<Search, 'limit'>): Population {
  if (search !== null || type !== null)
    return { kind: 'filtered_devices', search, type, building_id, floor };
  if (building_id !== null || floor !== null) return { kind: 'location', building_id, floor };
  return { kind: 'dataset' };
}

const sources = {
  find_devices: { route: '/api/v2/devices', href: '/devices', ttl: CACHE_TTL.DEVICES_LIST },
  get_health_summary: {
    route: '/api/v2/analytics/health',
    href: '/analytics',
    ttl: CACHE_TTL.HEALTH,
  },
  get_anomalies: {
    route: '/api/v2/analytics/anomalies',
    href: '/analytics',
    ttl: CACHE_TTL.ANOMALIES,
  },
  get_device: { route: '/api/v2/devices/[id]', href: '/devices', ttl: null },
  get_readings_window: { route: '/api/v2/readings', href: '/devices', ttl: null },
} as const;

const utc = z.iso.datetime();

export function readEvidence<N extends ToolName>(
  name: N,
  filters: EvidenceFilters[N],
  population: Population,
  snapshot: Snapshot<ToolData<N>>,
  limitations: string[],
  resolution?: SearchResolution
): ExecutedRead<N> {
  // An empty search answers locally. Its evidence is the device list actually read.
  const source = resolution?.total === 0 ? sources.find_devices : sources[name];
  const { computedAt, retrievedAt } = snapshot;
  if (
    !utc.safeParse(retrievedAt).success ||
    (computedAt !== null && !utc.safeParse(computedAt).success)
  )
    throw new ToolError('INVALID_RESULT');

  if (computedAt === null || Date.parse(computedAt) > Date.parse(retrievedAt))
    limitations.push('UNKNOWN_FRESHNESS');
  else if (
    source.ttl !== null &&
    Date.parse(retrievedAt) - Date.parse(computedAt) > source.ttl * 1000
  )
    limitations.push('STALE_SNAPSHOT');
  if (
    resolution &&
    resolution.total > 0 &&
    (resolution.computedAt === null ||
      Date.parse(resolution.computedAt) > Date.parse(resolution.retrievedAt) ||
      Date.parse(retrievedAt) - Date.parse(resolution.computedAt) > CACHE_TTL.DEVICES_LIST * 1000)
  )
    limitations.push('COHORT_FRESHNESS_LIMITED');

  return {
    name,
    route: source.route,
    href:
      population.kind === 'device'
        ? `/devices/${encodeURIComponent(population.device_id)}`
        : source.href,
    filters,
    population,
    snapshot,
    limitations,
    ...(resolution && { resolution }),
  };
}

export function readingLimitations(
  data: ToolData<'get_readings_window'>,
  anomalies: boolean
): string[] {
  const warnings = ['RETENTION_DOES_NOT_PROVE_COMPLETE_COVERAGE'];
  if (data.truncated) warnings.push(anomalies ? 'ANOMALY_ROWS_PARTIAL' : 'READING_ROWS_PARTIAL');
  const sources = new Set(data.rows.map(row => row.source));
  if (sources.has('simulation')) warnings.push('RETURNED_ROWS_SIMULATED');
  if (sources.size > 1) warnings.push('MIXED_READING_SOURCES');
  if (data.rows.some(row => !row.is_valid)) warnings.push('RETURNED_ROW_INVALID');
  if (anomalies) warnings.push('ANOMALY_SCORE_NOT_FAILURE_PROBABILITY');
  return warnings;
}
