/**
 * Index Shape Comparison Tests
 *
 * `verify-indexes.ts`'s dedup check historically compared only key fields (as a
 * SUBSET match — extra fields on the live index were ignored) and the `unique`
 * flag. It never looked at `partialFilterExpression`. That let a plain unique
 * index on `{rule_id, device_id}` pass verification as though it were the partial
 * dedup index defined in AlertV2.ts:167-170.
 *
 * That confusion is catastrophic, not cosmetic: a plain (non-partial) unique index
 * permits exactly one alert document EVER per (rule, device) pair, instead of one
 * *open* one. The first resolved episode then permanently blocks every later
 * episode for that device, and the evaluator absorbs the resulting E11000 as a
 * benign race (see the duplicate-key handling in lib/alerting/evaluate.ts) — so
 * alerting goes silent with no error, no log, and no metric movement. The verifier
 * is the only thing standing between that state and production.
 *
 * These tests pin the fixed comparison logic in scripts/v2/index-shape.ts. No live
 * database is involved — that is the point of extracting the comparison functions
 * out of verify-indexes.ts and create-indexes-v2.ts, both of which connect to
 * MongoDB and run unconditionally at import time.
 */

import {
  checkIndexExists,
  indexShapeMatches,
  keysMatch,
  partialFilterExpressionsMatch,
  type IndexInfo,
} from '@/scripts/v2/index-shape';

// The real expectation declared in verify-indexes.ts for AlertV2's dedup index.
// Reproduced here (rather than imported) so these tests pin behavior against a
// value that cannot silently drift out of sync with the actual comparison inputs.
const RULE_DEVICE_OPEN_UNIQUE_EXPECTATION = {
  fields: { rule_id: 1, device_id: 1 },
  unique: true,
  partialFilterExpression: { is_open: true },
};

describe('checkIndexExists — AlertV2 dedup index', () => {
  it('REJECTS a plain unique index on {rule_id, device_id} when the expectation declares a partialFilterExpression', () => {
    // This is the catastrophic case from the task brief: an index that is unique
    // and has the right keys, but is missing the partial filter entirely.
    const plainUniqueIndex: IndexInfo[] = [
      { name: 'rule_device_open_unique', key: { rule_id: 1, device_id: 1 }, unique: true },
    ];

    expect(checkIndexExists(plainUniqueIndex, RULE_DEVICE_OPEN_UNIQUE_EXPECTATION)).toBe(false);
  });

  it('ACCEPTS the correct partial unique index', () => {
    const correctIndex: IndexInfo[] = [
      {
        name: 'rule_device_open_unique',
        key: { rule_id: 1, device_id: 1 },
        unique: true,
        partialFilterExpression: { is_open: true },
      },
    ];

    expect(checkIndexExists(correctIndex, RULE_DEVICE_OPEN_UNIQUE_EXPECTATION)).toBe(true);
  });

  it('REJECTS an index with the right filter but unique: false', () => {
    const nonUniqueIndex: IndexInfo[] = [
      {
        name: 'rule_device_open_unique',
        key: { rule_id: 1, device_id: 1 },
        unique: false,
        partialFilterExpression: { is_open: true },
      },
    ];

    expect(checkIndexExists(nonUniqueIndex, RULE_DEVICE_OPEN_UNIQUE_EXPECTATION)).toBe(false);
  });

  it('does not let rule_device_resolved_at (as actually defined in AlertV2.ts) satisfy rule_device_open_unique', () => {
    // The real, adjacent index: same first two fields, plus a third, and NOT
    // unique. Note this case is already rejected today by the `unique` check
    // alone (expected.unique: true vs. this index's unique: undefined) — see the
    // isolating test directly below for the case that pins the field-exactness
    // fix (item 3) specifically, independent of `unique`.
    const resolvedAtIndex: IndexInfo[] = [
      {
        name: 'rule_device_resolved_at',
        key: { rule_id: 1, device_id: 1, 'audit.resolved_at': -1 },
      },
    ];

    expect(checkIndexExists(resolvedAtIndex, RULE_DEVICE_OPEN_UNIQUE_EXPECTATION)).toBe(false);
  });

  it('does not let a rule_device_resolved_at-shaped index satisfy rule_device_open_unique even when unique and filter also match', () => {
    // Isolates the field-exactness fix (item 3) from the `unique`/filter checks.
    // Old behavior compared fields as a SUBSET match: every one of `expected.fields`
    // just had to be present with the right value on the live index, so an index
    // with an extra third field ({rule_id, device_id, 'audit.resolved_at'}) would
    // satisfy an expectation of {rule_id, device_id}. Under the old comparison,
    // this synthetic index — unique and filtered exactly like the real dedup
    // index, but with the extra field — would have been wrongly ACCEPTED. Fields
    // must now match exactly (same fields, same order), so it is rejected purely
    // for the extra field.
    const supersetShapedIndex: IndexInfo[] = [
      {
        name: 'rule_device_resolved_at',
        key: { rule_id: 1, device_id: 1, 'audit.resolved_at': -1 },
        unique: true,
        partialFilterExpression: { is_open: true },
      },
    ];

    expect(checkIndexExists(supersetShapedIndex, RULE_DEVICE_OPEN_UNIQUE_EXPECTATION)).toBe(false);
  });
});

describe('checkIndexExists — supplementary properties', () => {
  it('treats partialFilterExpression comparison as key-order-insensitive', () => {
    // Item 1 requires "order-insensitive structural equality" for the filter
    // comparison specifically (unlike the key/field comparison, which item 3
    // requires to be order-SENSITIVE). A live filter with keys in a different
    // order than the expectation must still match.
    const differentKeyOrder: IndexInfo[] = [
      {
        name: 'rule_device_open_unique',
        key: { rule_id: 1, device_id: 1 },
        unique: true,
        partialFilterExpression: { extra: 1, is_open: true },
      },
    ];
    const expectation = {
      fields: { rule_id: 1, device_id: 1 },
      unique: true,
      partialFilterExpression: { is_open: true, extra: 1 },
    };

    expect(checkIndexExists(differentKeyOrder, expectation)).toBe(true);
  });
});

describe('keysMatch', () => {
  it('accepts identical fields in identical order', () => {
    expect(keysMatch({ rule_id: 1, device_id: 1 }, { rule_id: 1, device_id: 1 })).toBe(true);
  });

  it('rejects the same fields in a different order', () => {
    // Item 3 explicitly requires "same fields, same order" — field order is
    // functionally significant for compound indexes (it determines which query
    // and sort patterns the index can serve), so this must not be treated as
    // equivalent even though both sides contain the same field/value pairs.
    expect(keysMatch({ device_id: 1, rule_id: 1 }, { rule_id: 1, device_id: 1 })).toBe(false);
  });

  it('rejects a superset of fields (the old subset-match bug)', () => {
    expect(
      keysMatch({ rule_id: 1, device_id: 1, 'audit.resolved_at': -1 }, { rule_id: 1, device_id: 1 })
    ).toBe(false);
  });

  it('rejects a matching field with a different sort direction', () => {
    expect(keysMatch({ rule_id: 1, device_id: -1 }, { rule_id: 1, device_id: 1 })).toBe(false);
  });
});

describe('partialFilterExpressionsMatch', () => {
  it('matches when both are undefined', () => {
    expect(partialFilterExpressionsMatch(undefined, undefined)).toBe(true);
  });

  it('does not match when only the actual index has a filter', () => {
    expect(partialFilterExpressionsMatch({ is_open: true }, undefined)).toBe(false);
  });

  it('does not match when only the expectation has a filter', () => {
    expect(partialFilterExpressionsMatch(undefined, { is_open: true })).toBe(false);
  });

  it('does not match when filter values differ', () => {
    expect(partialFilterExpressionsMatch({ is_open: false }, { is_open: true })).toBe(false);
  });

  it('matches identical filters regardless of key order', () => {
    expect(partialFilterExpressionsMatch({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
});

describe('indexShapeMatches — create-indexes-v2.ts mismatch detection', () => {
  // The expected shape create-indexes-v2.ts declares for rule_device_open_unique.
  const EXPECTED_SHAPE = {
    fields: { rule_id: 1, device_id: 1 },
    unique: true,
    partialFilterExpression: { is_open: true },
  };

  it('ACCEPTS a live index that is an exact match', () => {
    expect(
      indexShapeMatches(
        {
          key: { rule_id: 1, device_id: 1 },
          unique: true,
          partialFilterExpression: { is_open: true },
        },
        EXPECTED_SHAPE
      )
    ).toBe(true);
  });

  it('REJECTS a plain unique index missing the partialFilterExpression', () => {
    // Mirrors the central checkIndexExists case, for create-indexes-v2.ts's
    // separate consumer: a same-name index existing in the database with this
    // shape must be reported as a mismatch, not silently [SKIP]ped.
    expect(
      indexShapeMatches({ key: { rule_id: 1, device_id: 1 }, unique: true }, EXPECTED_SHAPE)
    ).toBe(false);
  });

  it('REJECTS when unique does not match exactly, even if the expectation does not require it', () => {
    // Unlike checkIndexExists (an "at-least-this-strict" existence check, where an
    // expectation that does not require uniqueness is satisfied by any index),
    // indexShapeMatches is an exact-equality check used to decide whether a
    // pre-existing index is safe to leave alone. An unexpectedly-unique index is a
    // real drift worth flagging, so `unique` must be compared exactly here.
    const expectedWithoutUnique = { fields: { status: 1 } };
    expect(indexShapeMatches({ key: { status: 1 }, unique: true }, expectedWithoutUnique)).toBe(
      false
    );
  });
});
