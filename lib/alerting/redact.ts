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
 */
export function redactAuditForDemo<T extends WithAudit>(record: T, isDemoCaller: boolean): T;
export function redactAuditForDemo<T extends WithAudit>(records: T[], isDemoCaller: boolean): T[];
export function redactAuditForDemo<T extends WithAudit>(
  recordOrRecords: T | T[],
  isDemoCaller: boolean
): T | T[] {
  if (!isDemoCaller) return recordOrRecords;
  return Array.isArray(recordOrRecords)
    ? recordOrRecords.map(redactAuditRecord)
    : redactAuditRecord(recordOrRecords);
}
