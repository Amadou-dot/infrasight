/**
 * Demo-mode redaction for alert / alert-rule audit trails.
 *
 * `audit.created_by` / `updated_by` / `acknowledged_by` / `resolved_by` /
 * `deleted_by` are written by `getAuditUser()` (lib/auth/index.ts), which
 * resolves to the acting admin's Clerk EMAIL whenever one is on file — never
 * just their user id. `requireOrgMembership()` grants an anonymous demo-mode
 * visitor (see `isDemoCaller` in lib/auth) the same read access as a real org
 * member, so without this step every GET on alerts/alert-rules would hand a
 * stranger a real administrator's email address.
 *
 * This is deliberately narrower than the pre-existing fact that every other
 * v2 GET also returns `audit.created_by` (etc.) to a demo reader — that is
 * tracked separately and out of scope here. This module only covers the
 * alert / alert-rule audit shape (see IAlertAudit / IAlertRuleAudit).
 */

import { jsonSuccess, jsonPaginated, type PaginationInfo } from '@/lib/api/response';

// ============================================================================
// THE MARKER — why redaction is a TYPE and not just a call
// ============================================================================

/**
 * `redactAuditForDemo` used to be identity-typed: input type === output type,
 * so a route that simply never called it looked exactly like a route that did.
 * That is not hypothetical — within this PR `POST /alert-rules` and
 * `PATCH /alert-rules` shipped without it while their siblings had it, and
 * nothing but review caught the asymmetry.
 *
 * `Redacted<T>` is a phantom brand: it exists only in the type system (no
 * runtime property is ever written, so serialization is untouched) and it is
 * REQUIRED, not optional — an optional brand would make every `T` assignable
 * to `Redacted<T>` and buy nothing. `Redacted<T>` stays assignable TO `T`, so
 * downstream code that reads fields off a redacted record is unaffected.
 *
 * The enforcement point is `jsonRedacted` / `jsonRedactedPaginated` below: the
 * four alert / alert-rule routes return through those instead of
 * `jsonSuccess` / `jsonPaginated`, so skipping the redaction call is a compile
 * error rather than a silent leak of an administrator's email address.
 *
 * Caveat worth knowing before you trust it blindly: `Redacted<any>` collapses
 * to `any`. Both list endpoints have an `AlertV2.aggregate(...)` branch that is
 * typed `any[]`, so on that one path the marker is inert. It still holds for
 * every `.lean()` / `.toObject()` result, which is every single-record
 * response and every mutation response.
 */
declare const RedactedBrand: unique symbol;

/** A value that has been through `redactAuditForDemo`. See the note above. */
export type Redacted<T> = T & { readonly [RedactedBrand]: true };

const AUDIT_ACTOR_FIELDS = [
  'created_by',
  'updated_by',
  'acknowledged_by',
  'resolved_by',
  'deleted_by',
] as const;

/** Stand-in that still tells a demo visitor a human acted, without naming one. */
const REDACTED_ACTOR = 'an administrator';

// Deliberately `object`, not `Record<string, unknown>`: the callers' real
// audit types (IAlertAudit, IAlertRuleAudit) are concrete interfaces with no
// index signature, so they are not structurally assignable to
// `Record<string, unknown>` — that would make every call site fail to
// type-check. `object` accepts them; the field-by-field access below is cast
// internally instead, which is safe because it only ever replaces an
// existing STRING field with another string.
type WithAudit = { audit?: object | null };

function redactAuditRecord<T extends WithAudit>(record: T): T {
  if (!record?.audit) return record;

  const audit: Record<string, unknown> = { ...(record.audit as Record<string, unknown>) };
  let changed = false;
  for (const field of AUDIT_ACTOR_FIELDS) {
    const value = audit[field];
    // 'system' (auto-fired, auto-resolved, or swept) never carries a real
    // person's identity — leave it as-is so a demo visitor can still tell an
    // event was automatic rather than performed by an admin.
    if (typeof value === 'string' && value !== 'system') {
      audit[field] = REDACTED_ACTOR;
      changed = true;
    }
  }

  // Preserve reference equality when nothing needed redacting, matching the
  // "pass through untouched for a real caller" contract callers rely on.
  // The cast back to T is safe: only existing string-valued fields were
  // replaced with another string, so the concrete audit shape still holds.
  return changed ? ({ ...record, audit } as T) : record;
}

/**
 * Redact every actor field on one alert/alert-rule record — or every record
 * in a list — whenever `isDemoCaller` is true. A no-op for a genuinely
 * authenticated caller, returning the exact input reference unchanged.
 *
 * Returns `Redacted<…>`, which is a compile-time marker only: the runtime
 * value is byte-identical to what this function returned before the marker
 * existed, reference equality included.
 */
export function redactAuditForDemo<T extends WithAudit>(
  record: T,
  isDemoCaller: boolean
): Redacted<T>;
export function redactAuditForDemo<T extends WithAudit>(
  records: T[],
  isDemoCaller: boolean
): Redacted<T[]>;
export function redactAuditForDemo<T extends WithAudit>(
  recordOrRecords: T | T[],
  isDemoCaller: boolean
): Redacted<T> | Redacted<T[]> {
  if (!isDemoCaller) return recordOrRecords as Redacted<T> | Redacted<T[]>;
  return (
    Array.isArray(recordOrRecords)
      ? recordOrRecords.map(redactAuditRecord)
      : redactAuditRecord(recordOrRecords)
  ) as Redacted<T> | Redacted<T[]>;
}

// ============================================================================
// RESPONSE HELPERS THAT DEMAND THE MARKER
// ============================================================================

/**
 * `jsonSuccess`, but it will only accept a record that went through
 * `redactAuditForDemo`.
 *
 * Deliberately non-generic. `jsonRedacted<T>(data: Redacted<T>)` would ask
 * TypeScript to infer `T` out of an intersection, which is exactly the kind of
 * inference that quietly degrades to `unknown` and stops rejecting anything.
 * The parameter type here is just "carries the brand", which is the whole
 * property being enforced — the body is serialized, so nothing downstream
 * needs the element type.
 */
export function jsonRedacted(data: Redacted<unknown>, message?: string, status = 200): Response {
  return jsonSuccess(data, message, status);
}

/** `jsonPaginated`, but it will only accept a list that went through `redactAuditForDemo`. */
export function jsonRedactedPaginated(
  data: Redacted<unknown[]>,
  pagination: PaginationInfo,
  status = 200
): Response {
  return jsonPaginated(data, pagination, status);
}

/**
 * Attach extra, non-audit fields to an already-redacted record, keeping the
 * marker.
 *
 * Needed by `GET /api/v2/alerts/[id]?include_device=true`, which returns the
 * alert plus a device projection. A bare `{ ...alert, device }` would be
 * correct at runtime but the annotation the old code used
 * (`Record<string, unknown>`) erased the marker, so `jsonRedacted` could not
 * tell the difference between "redacted, then extended" and "never redacted".
 *
 * The `extra` object must not contain audit actor fields — this function does
 * not redact, it only carries the marker forward. Today's one caller adds a
 * device projection (`_id`, `serial_number`, `type`, `location`), none of
 * which names a person.
 */
export function extendRedacted<T extends Redacted<unknown>, E extends object>(
  record: T,
  extra: E
): Redacted<T & E> {
  return { ...record, ...extra } as Redacted<T & E>;
}
