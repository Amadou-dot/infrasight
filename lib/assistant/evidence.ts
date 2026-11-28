import { z } from 'zod';
import { CACHE_TTL } from '@/lib/cache';
import type { Snapshot } from '@/lib/data/read-context';
import { deviceDetailHref } from '@/lib/utils/device-href';
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

const ANALYTICS_MAX_AGE_SECONDS = 60;
const sources = {
  find_devices: {
    route: '/api/v2/devices',
    href: '/devices',
    ttl: Math.min(30, CACHE_TTL.DEVICES_LIST),
  },
  get_health_summary: {
    route: '/api/v2/analytics/health',
    href: '/analytics',
    ttl: Math.min(ANALYTICS_MAX_AGE_SECONDS, CACHE_TTL.HEALTH),
  },
  get_anomalies: {
    route: '/api/v2/analytics/anomalies',
    href: '/analytics',
    ttl: Math.min(ANALYTICS_MAX_AGE_SECONDS, CACHE_TTL.ANOMALIES),
  },
  get_device: { route: '/api/v2/devices/[id]', href: '/devices', ttl: null },
  get_readings_window: { route: '/api/v2/readings', href: '/devices', ttl: null },
} as const;

const utc = z.iso.datetime();

function evidenceSource(name: ToolName, resolution?: SearchResolution) {
  // An empty scoped search answers locally. Its evidence is the device list actually read.
  return resolution?.total === 0 ? sources.find_devices : sources[name];
}

function checkAge(
  { computedAt, retrievedAt }: Pick<Snapshot<unknown>, 'computedAt' | 'retrievedAt'>,
  ttl: number | null,
  now: number,
  limitations: string[],
  unknownWarning: string
) {
  if (
    !utc.safeParse(retrievedAt).success ||
    (computedAt !== null && !utc.safeParse(computedAt).success)
  )
    throw new ToolError('INVALID_RESULT');

  const retrieved = Date.parse(retrievedAt);
  const computed = computedAt === null ? null : Date.parse(computedAt);
  const known = computed !== null && computed <= retrieved;
  // Even when computation time is unknown, the evidence is at least as old as its retrieval.
  const age = Math.max(now, retrieved) - (known ? computed : retrieved);
  if (ttl !== null && !(age <= ttl * 1000)) throw new ToolError('READ_UNAVAILABLE');
  if (!known || retrieved > now) limitations.push(unknownWarning);
}

/** Evaluate age when evidence is released, including time spent in the final access check. */
export function checkEvidenceFreshness(read: AnyExecutedRead) {
  const now = Date.now();
  const { resolution, limitations } = read;
  checkAge(
    read.snapshot,
    evidenceSource(read.name, resolution).ttl,
    now,
    limitations,
    'UNKNOWN_FRESHNESS'
  );
  if (resolution && resolution.total > 0)
    checkAge(resolution, sources.find_devices.ttl, now, limitations, 'COHORT_FRESHNESS_LIMITED');
}

export function readEvidence<N extends ToolName>(
  name: N,
  filters: EvidenceFilters[N],
  population: Population,
  snapshot: Snapshot<ToolData<N>>,
  limitations: string[],
  resolution?: SearchResolution
): ExecutedRead<N> {
  const source = evidenceSource(name, resolution);

  return {
    name,
    route: source.route,
    href: population.kind === 'device' ? deviceDetailHref(population.device_id) : source.href,
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
