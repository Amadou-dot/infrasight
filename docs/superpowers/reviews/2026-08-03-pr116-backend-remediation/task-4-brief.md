## Task 4: Make `for_duration_seconds` symmetric

**File:** `lib/alerting/evaluate.ts`

The new-episode branch decides purely on the rule (`:236`):

```ts
const firesImmediately = (rule.for_duration_seconds ?? 0) === 0;
```

while the promotion branch six lines later uses in-batch elapsed time (`:276-278`):

```ts
const elapsedMs = state.lastObservedAt.getTime() - toDate(existing.breached_since).getTime();
if (elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000) { /* fire */ }
```

So a batch carrying a 120-second continuous breach against a `for_duration_seconds: 60` rule
only opens a `pending` episode and waits for a second request — yet the identical batch fires
immediately if a pending episode happens to already exist. The reduction already computes both
`breachedSince` and `lastObservedAt`, so the two branches can share one predicate.

This is **not** covered by the documented "not a timeline replay" trade-off at `:106-109`: that
decision governs how the batch reduces, and both branches already reduce identically. The
asymmetry is unintended.

Required: the new-episode branch must fire immediately when the batch's own breach span already
satisfies `for_duration_seconds`:

```ts
const elapsedMs = state.lastObservedAt.getTime() - (state.breachedSince as Date).getTime();
const firesImmediately = elapsedMs >= (rule.for_duration_seconds ?? 0) * 1000;
```

Keep `fired_at: now` (not the in-batch timestamp) so it matches the promotion branch.

If Task 2 changed how `state.breachedSince` is narrowed, use whatever that task left in place
rather than reintroducing a cast.

### Tests

- One batch, continuous breach spanning longer than `for_duration_seconds` → alert opens with
  status `firing` and a `fired_at`, and appears in `result.fired`.
- One batch spanning less than `for_duration_seconds` → alert opens `pending`, no `fired_at`,
  not in `result.fired`.
- Boundary: elapsed exactly equal to `for_duration_seconds * 1000` fires (`>=`).
- `for_duration_seconds: 0` still fires immediately (existing behavior preserved).

Verify the first test fails against the current code.

---

