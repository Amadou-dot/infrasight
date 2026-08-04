## Task 8: Make the client-facing wire contract true

**Files:** `types/v2/alert.types.ts`, `app/api/v2/alerts/route.ts`,
`app/api/v2/alerts/[id]/route.ts`, `app/api/v2/alert-rules/route.ts`,
`app/api/v2/alert-rules/[id]/route.ts`

Nothing in the repo references `AlertV2Response`, `AlertRuleV2Response`, `CreateAlertRuleBody`,
`UpdateAlertRuleBody`, `ListAlertsQueryParams`, or `AlertEvent` — every occurrence is the
definition or the barrel re-export in `types/v2/index.ts`. Because no route is typed against
them, they are unverified prose, and they have already drifted. Tasks 12–20 will build the
client against these types, so they must be correct before that starts.

Required:

1. **Fix the false header claim.** `types/v2/alert.types.ts:4-5` states
   "`lib/pusher-context.tsx` imports AlertEvent from this file." That file contains zero
   occurrences of "alert". State that it is consumed once Task 13/14 lands.
2. **Fix `UpdateAlertRuleBody`.** It is `Partial<CreateAlertRuleBody>`, which permits
   `{ threshold: 5 }` — a request `updateAlertRuleSchema` always rejects, because
   `{metric, comparison, threshold, selector}` must move as an atomic group
   (`lib/validations/v2/alert-rule.validation.ts:144-154`). Model that group so a partial
   condition is not expressible.
3. **Fix `CreateAlertRuleBody`.** `selector` is optional in the type but required and non-empty
   when `metric === 'value'` (`alert-rule.validation.ts:64-67`). Model the per-metric shape as a
   discriminated union on `metric`, so the two states the schema always rejects become
   unrepresentable. Threshold bounds (`anomaly_score` ∈ [0,1], `battery_level` ∈ [0,100]) stay
   in Zod — TypeScript has no refinement types — but document them on the union arms.
4. **Account for `__v`.** It ships in every alert and alert-rule response and appears in no wire
   type. Strip it at the response boundary in all four route files rather than adding it to the
   contract: `.lean()` reads get a `__v: 0` projection or equivalent, `.toObject()` calls use
   `{ versionKey: false }`. Keep using `jsonSuccess`/`jsonPaginated`.
5. **Fix the false caching rationale.** `app/api/v2/alerts/route.ts:11-12` justifies not caching
   because the list "is already pushed over Pusher". Nothing publishes alerts over Pusher — both
   call sites discard the evaluator's result. The decision not to cache may still be right;
   restate it on a true premise.
6. **Defuse the `actor` privacy trap.** `types/v2/alert.types.ts:171` requires `actor` to be the
   Clerk **user ID**, "Never an email — this payload reaches every connected client." But the
   manual-resolve handler has `auditUser` in scope (`app/api/v2/alerts/[id]/route.ts:147-148`),
   and `getAuditUser` is `user?.email || userId` (`lib/auth/index.ts:262`) — the email whenever
   one exists. Whoever wires Task 13 will reach for the variable that is already there and
   broadcast admin emails to every browser. Make the comment name `userId` from `requireAdmin()`
   explicitly as the value to use, and say plainly that `auditUser`/`getAuditUser` must not be
   used for this field.

`ResolvedAlert.resolution` includes `'manual'`, which that payload can never carry today (no
manual path broadcasts). Leave the union as-is — Task 13 will use it — but note the gap in your
report rather than changing it.

### Tests

Type-level correctness is enforced by `tsc`, so the runnable coverage here is the `__v` change:
assert in the alert and alert-rule integration tests that responses do not carry `__v`. Verify
those assertions fail against the current code.

---

