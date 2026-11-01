# Floor Plan fetching performance

The approved scope is the five improvements identified in the live investigation:
filter Floor Plan requests by building/floor and project tile fields; fetch reading
batches concurrently and publish them progressively; retain readings in React Query;
cache latest-reading API responses; parallelize metadata aggregations. Deliver a PR,
without merging or changing production infrastructure.

The current fleet takes five device requests followed by ten serial reading batches.
The measured reading stage was 11.5 seconds. Three concurrent batches took 4.6 seconds;
the selected building plus projected fields and parallel readings took 2.2 seconds.
These are diagnostic samples, not performance guarantees.

## Approach

Use the existing filtered device API and TanStack Query, keeping batches of 50 IDs
and limiting concurrency to three. Publish successful batches immediately, retain
completed snapshots across navigation, and merge by timestamp so HTTP cannot undo
newer Pusher events. Scope keys to the selected IDs; cancellation must prevent late
work from publishing. Expose loading, empty, partial-error and retry states.

Wait for the initial building choice before requesting devices; preserve a deliberate
All Buildings selection and floor zero. Use a typed projection for tile data, leaving
detail fetching to the modal. Keep the existing API response envelopes and auth gates.

Cache latest-reading responses for ten seconds, including all query options and
organization in the key. Authenticate and validate before cache access, and connect
MongoDB only on cache misses. Preserve invalid-reading and quality-metrics behavior;
Redis unavailability falls back to MongoDB. Leave historical query semantics intact.
Profile query plans only against an explicitly available database; do not infer live
index use from schema declarations or create production indexes in this change.

Run the five independent metadata aggregates concurrently and defer its MongoDB
connection until a cache miss. Preserve metadata contracts and optional statistics.

## Alternatives

Increasing batch size alone risks URL limits and still blocks display. A new combined
snapshot endpoint or ingestion-maintained current-state collection is a larger change
than the evidence requires. Existing APIs, bounded concurrency and caching deliver
the measured improvements without a database migration or dependency changes.

## Verification

Regression tests cover bounded concurrency, progressive rendering, cancellation,
failed batches and retry, out-of-order HTTP/Pusher updates, remount caching, building
switches, explicit All Buildings and floor zero. Route tests cover org/query cache
isolation, cache-hit database avoidance, fallback, and unchanged metadata responses.
Run the full Jest coverage gate, TypeScript, ESLint and production build; inspect the
page at desktop and phone widths. Report mocked-browser and live-database evidence
separately. An independent final review precedes PR creation.
