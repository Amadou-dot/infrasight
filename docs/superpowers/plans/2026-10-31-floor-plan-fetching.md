# Floor Plan Fetching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce time to useful Floor Plan readings and open a verified PR.

**Architecture:** Keep existing APIs; narrow device requests and use three concurrent
50-ID reading batches with progressive, timestamp-safe React Query caching. Cache
server snapshots for ten seconds and execute metadata queries concurrently.

**Tech Stack:** Next.js, React, TanStack Query, MongoDB/Mongoose, Redis, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-floor-plan-fetching-design.md`

## Global Constraints

- No dependency additions, database migrations, merge, or production writes.
- Preserve auth, API envelopes, quality options, and 50-ID URL-safe batches.
- Three concurrent requests; ten-second latest-reading server/client freshness.
- Merge readings by timestamp and isolate selection changes.
- Existing user approval covers implementation and PR creation; execute inline.

## Review Focus

- Late HTTP and out-of-order Pusher events must not regress displayed readings.
- Cancellation/failure must not leave partial data permanently marked fresh.
- Filter switches must not show devices/readings from another building.
- Cache keys must distinguish org, invalid-reading and quality-metrics options.
- Initial selection, explicit All Buildings, empty results, and floor zero work.

### Task 1: Bounded progressive reading transport

**Files:** `lib/api/latest-readings.ts`, `__tests__/unit/lib/latest-readings.test.ts`.

**Interfaces:** `fetchLatestReadingsBatched(deviceIds, { signal?, onBatch? })`
returns `Promise<Record<string, LatestReading>>`; batches publish the same map shape.

- [ ] Write deferred-fetch tests proving three requests start, the fourth waits,
      successful batches publish before the slowest completes, failures reject,
      duplicate IDs are deduplicated, and abort prevents later publication/work.
- [ ] Run `pnpm exec jest __tests__/unit/lib/latest-readings.test.ts --runInBand`.
      Expected: new behavior assertions fail before implementation.
- [ ] Implement bounded workers, response validation, abort handling and callbacks.
- [ ] Run the same tests. Expected: all pass. Commit the transport change.

### Task 2: Scoped Floor Plan queries and retained readings

**Files:** `lib/query/hooks/useLatestReadings.ts`, `lib/query/hooks/useFloorPlanDevices.ts`,
`lib/api/v2-client.ts`, `lib/utils/floor-plan.ts`, `components/FloorPlan.tsx`,
`app/floor-plan/page.tsx`, corresponding jsdom tests.

**Interfaces:** `useLatestReadings(deviceIds)` provides readings, fetching/error and
retry state; `useFloorPlanDevices({ building_id?, floor? }, { enabled })` provides a
typed tile projection. Uses Task 1 transport and existing Pusher subscription.

- [ ] Add real QueryClient/component tests for progressive values, stale HTTP/Pusher,
      remount caching, failed-batch retry, cancellation, projected filtered requests,
      metadata initialization, All Buildings, floor zero and empty/error states.
- [ ] Run targeted jsdom suites. Expected: new behavior fails before implementation.
- [ ] Implement query hooks and UI integration, with timestamp merging and isolated keys.
- [ ] Run targeted tests and TypeScript. Expected: pass. Commit the client changes.

### Task 3: Latest-readings API caching

**Files:** `app/api/v2/readings/latest/route.ts`, `lib/cache/keys.ts`,
latest-reading cache route tests and `__tests__/unit/lib/cacheKeys.test.ts`.

**Interfaces:** Use existing `getOrSet` with `CACHE_TTL.READINGS_LATEST`, a complete
query/options/org key, and the existing API response shape.

- [ ] Add tests for second-request reuse, auth on cache hit, distinct org/options,
      canonical ID order, failed-loader retry and no Mongo connection on cache hits.
- [ ] Run targeted route/key tests. Expected: caching assertions fail.
- [ ] Implement caching after auth/validation; move DB connection into loader.
- [ ] Run route tests plus real-Mongo readings integration. Expected: pass.
      Record query-plan inspection limits; commit the API change.

### Task 4: Metadata concurrency and delivery

**Files:** `app/api/v2/metadata/route.ts`, metadata route tests, verification notes.

**Interfaces:** Same metadata response; five independent aggregates execute together.

- [ ] Add deferred-aggregate tests and cache-hit database-avoidance coverage.
- [ ] Run targeted tests. Expected: concurrency/cache assertions fail.
- [ ] Implement Promise.all and connection-on-miss; run targeted tests. Expected: pass.
- [ ] Run `pnpm exec jest --coverage --runInBand`, `pnpm exec tsc --noEmit`,
      `pnpm lint`, `pnpm build`; inspect desktop/phone loading with controlled delays.
      Expected: successful gates and progressive, correctly scoped values.
- [ ] Commit, obtain independent whole-branch review, fix substantive findings,
      push the feature branch and create the PR. Do not merge.
