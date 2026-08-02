/**
 * Server-internal alerting types.
 *
 * Wire types that cross to the browser live in `types/v2/alert.types.ts` —
 * this file imports from models and is server-only.
 */

import type { IDeviceV2 } from '@/models/v2/DeviceV2';
import type { IReadingV2 } from '@/models/v2/ReadingV2';
import type { IAlertRuleV2 } from '@/models/v2/AlertRuleV2';
import type { FiredAlert, ResolvedAlert } from '@/types/v2/alert.types';

/**
 * The device projection evaluation needs. Callers pass the documents they have
 * already loaded, so evaluation adds no device query to either write path.
 */
export type EvaluableDevice = Pick<IDeviceV2, '_id' | 'type' | 'location' | 'metadata'>;

/** A reading as it exists just after insert — a partial document. */
export type EvaluableReading = Partial<IReadingV2>;

/**
 * A rule after a Redis JSON round trip: `_id` is a string, not an ObjectId.
 * See `lib/alerting/rule-cache.ts` for why this normalization is mandatory.
 */
export interface CachedAlertRule extends Omit<IAlertRuleV2, '_id'> {
  _id: string;
}

export interface EvaluationResult {
  /** Episodes that started firing in this evaluation. */
  fired: FiredAlert[];
  /** Episodes that auto-resolved in this evaluation. */
  resolved: ResolvedAlert[];
  /** Pending episodes opened (breach seen, duration not yet elapsed). */
  pendingOpened: number;
  /** Pending episodes deleted because the condition cleared first. */
  pendingCleared: number;
  /** New episodes suppressed by a rule's cooldown. */
  suppressed: number;
  /** Number of (rule, device) pairs considered. */
  evaluatedPairs: number;
}

export function emptyEvaluationResult(): EvaluationResult {
  return {
    fired: [],
    resolved: [],
    pendingOpened: 0,
    pendingCleared: 0,
    suppressed: 0,
    evaluatedPairs: 0,
  };
}
