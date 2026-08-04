## Task 9: Close the write-path integration test gaps

**Files:** `__tests__/integration/api/readings-ingest.integration.test.ts`,
`__tests__/integration/api/simulate-cron.integration.test.ts`,
`__tests__/integration/api/alerts.integration.test.ts`,
`__tests__/integration/api/alert-rules.integration.test.ts`

Mutation testing against the current suite found these behaviors have **no** covering test —
each mutation below broke zero of 2201 tests.

### 9a. Selector matching is never wired-verified on either write path

The PR widens the device projection on both write paths specifically so selectors work
(`readings/ingest/route.ts:149` and `cron/simulate/route.ts:46`, both adding `type`, `location`,
`metadata.tags`). Reverting both projections to their pre-PR shape breaks zero tests, because
both existing write-path alerting tests use `selector: { types: ['temperature'] }`, which needs
no device fields at all. A projection regression would silently disable every building, floor,
zone, and tag-scoped rule in the deployment.

Add to **each** write path: a rule whose selector uses `building_id`, `floor`, `zone`, and
`tags` against a device carrying those exact values — assert the alert fires. Add the negative
twin (a device on a different floor) so the test proves matching rather than mere field
presence.

**Mutation to verify against:** revert both projections to `{ _id: 1 }` (ingest) and
`{ _id: 1, type: 1, location: 1 }` (cron); both new tests must FAIL.

### 9b. Cron-path failure isolation is untested

`readings-ingest.integration.test.ts:1324` covers the ingest path well — it asserts
`expect(spy).toHaveBeenCalledTimes(1)` to prove the rejection was actually reached. The cron
path has no equivalent, and it is the only caller of `safeSweepStaleAlerts`, so a throwing sweep
is uncovered anywhere. Pointing the cron route at the raw throwing `evaluateReadings` /
`sweepStaleAlerts` instead of the `safe*` wrappers breaks zero tests.

Add two tests to the cron suite: spy `evaluateReadings` (then `sweepStaleAlerts`) to reject;
assert the response is 200, assert `ReadingV2.countDocuments()` matches the emitted device
count, and assert the spy was called.

### 9c. RBAC is untested on two endpoints

The guards are present and correct in code on all eight endpoints — this is a test gap, not a
security hole. But removing `requireOrgMembership()` from `app/api/v2/alerts/[id]/route.ts:46`
and `app/api/v2/alert-rules/[id]/route.ts:48` breaks zero tests, so a future refactor could drop
either silently.

Add member-role coverage for `GET /alerts/[id]` and `GET /alert-rules/[id]`. Also add
unauthenticated coverage — `mockAuthAsUnauthenticated` already exists in
`__tests__/setup/auth-helpers.ts:58` and is used elsewhere in the repo, but neither new test
file imports it.

Verify each new test fails against the corresponding mutation.

---

