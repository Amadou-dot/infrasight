/**
 * Index shape comparison helpers.
 *
 * Shared by `verify-indexes.ts` ("does a live index satisfy this expected shape?")
 * and `create-indexes-v2.ts` ("does a pre-existing, name-matched index exactly match
 * what this script would create?"). Pulled into its own side-effect-free module —
 * mirroring `db-guard.ts` — so the comparison logic is unit-testable without a live
 * database: both scripts connect to MongoDB and run unconditionally at import time,
 * so importing them directly in a test would attempt a real connection.
 */

/** An index as reported by MongoDB (`listIndexes()` / `collection.indexes()`). */
export interface IndexInfo {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

/** The shape a caller expects some index to have. */
export interface ExpectedIndex {
  name: string;
  fields: Record<string, number>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

/**
 * Whether two index key specs are identical: same fields, same sort direction,
 * same order.
 *
 * Field order is functionally significant for compound indexes — it determines
 * which query and sort patterns the index can serve — so this is deliberately an
 * exact, order-sensitive match rather than a subset check. A subset check would let
 * `rule_device_resolved_at`'s `{rule_id, device_id, 'audit.resolved_at': -1}` satisfy
 * an expectation of `rule_device_open_unique`'s `{rule_id, device_id}`, since the
 * former's first two fields happen to match the latter's only two fields.
 */
export function keysMatch(
  actualKey: Record<string, number>,
  expectedFields: Record<string, number>
): boolean {
  const actualEntries = Object.entries(actualKey);
  const expectedEntries = Object.entries(expectedFields);

  if (actualEntries.length !== expectedEntries.length) return false;

  return actualEntries.every(([field, order], i) => {
    const [expectedField, expectedOrder] = expectedEntries[i];
    return field === expectedField && order === expectedOrder;
  });
}

/**
 * Recursive, key-order-insensitive structural equality for plain JSON-like values.
 * Sufficient for comparing `partialFilterExpression` documents, which are ordinary
 * BSON filter predicates with no significance attached to key order.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }

  const aIsObject = typeof a === 'object' && a !== null;
  const bIsObject = typeof b === 'object' && b !== null;
  if (!aIsObject || !bIsObject) return false;

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(
    key =>
      Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key])
  );
}

/**
 * Whether two `partialFilterExpression` values match: exact and symmetric. Unlike
 * the `unique` flag (see `checkIndexExists`), there is no "unspecified means don't
 * care" case here — an index with a filter never satisfies an expectation with none,
 * and vice versa. That asymmetry is exactly what let a plain unique index on
 * `{rule_id, device_id}` masquerade as the partial dedup index: both have identical
 * keys and both are unique, differing only in a property nobody compared.
 */
export function partialFilterExpressionsMatch(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown> | undefined
): boolean {
  if (actual === undefined && expected === undefined) return true;
  if (actual === undefined || expected === undefined) return false;
  return deepEqual(actual, expected);
}

/**
 * Whether at least one live index satisfies the expected shape.
 *
 * Key fields and `partialFilterExpression` must match exactly. `unique` is checked
 * only when the expectation requires it — an expectation that doesn't care about
 * uniqueness is satisfied by either a unique or a non-unique index. This mirrors the
 * function's original, more permissive behavior; only `checkIndexExists` (an
 * "at-least-this-strict" existence check) treats `unique` this way. Callers
 * comparing a specific index against its exact intended definition — see
 * `indexShapeMatches` below — should not.
 */
export function checkIndexExists(
  indexes: IndexInfo[],
  expected: {
    fields: Record<string, number>;
    unique?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  }
): boolean {
  return indexes.some(idx => {
    const keyOk = keysMatch(idx.key, expected.fields);
    const uniqueOk = expected.unique ? idx.unique === true : true;
    const partialOk = partialFilterExpressionsMatch(
      idx.partialFilterExpression,
      expected.partialFilterExpression
    );
    return keyOk && uniqueOk && partialOk;
  });
}

/**
 * Whether a single, name-matched live index is an EXACT match for an expected
 * definition — fields, `unique`, and `partialFilterExpression` all identical.
 *
 * Unlike `checkIndexExists`, `unique` is compared exactly rather than treated as a
 * floor: this powers `create-indexes-v2.ts`'s pre-flight check for a same-name index
 * whose shape has drifted from what the script would create, where any difference —
 * including an index that is unique when it should not be, or vice versa — is a
 * mismatch worth flagging rather than silently skipping.
 */
export function indexShapeMatches(
  actual: {
    key: Record<string, number>;
    unique?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  },
  expected: {
    fields: Record<string, number>;
    unique?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  }
): boolean {
  const keyOk = keysMatch(actual.key, expected.fields);
  const uniqueOk = Boolean(actual.unique) === Boolean(expected.unique);
  const partialOk = partialFilterExpressionsMatch(
    actual.partialFilterExpression,
    expected.partialFilterExpression
  );
  return keyOk && uniqueOk && partialOk;
}
