# Infrasight — Portfolio Completeness Design

**Date:** 2026-07-30
**Status:** Approved
**Goal:** Make Infrasight work as an interview-generating portfolio piece.

## Audience and success criteria

The primary audience is a recruiter or hiring manager who clicks a link from a GitHub
profile or resume. The secondary audience is an engineer on a hiring panel who spends
five minutes clicking around and skimming code.

Success means:

1. A stranger opens the live URL and is looking at a working dashboard within one click,
   with no signup.
2. Nothing on the first screen is fabricated.
3. A visitor who never clicks the link still understands the project from the README.

Explicit non-goal: making the demo writable. Visitors get a read-only tour.

## Current state

The codebase is substantial and not the problem. Roughly 28k lines of source across
`app/`, `components/`, `lib/`, and `models/`, plus 2,020 test cases in 84 files. There are
25 v2 API endpoints, organization-scoped RBAC, Redis cache-aside with invalidation, rate
limiting, Sentry, Prometheus metrics, and PDF report generation.

The problem is that essentially none of it is reachable or visible.

### Findings

**F1 — Anonymous visitors get a 404.** `proxy.ts:23` calls `auth.protect()` with no
`unauthenticatedUrl`. Clerk's default for a signed-out user is a rewrite to Next's
not-found page rather than a redirect to sign-in, verified against production:

```
/           → 404    x-clerk-auth-reason: protect-rewrite
/devices    → 404    x-clerk-auth-reason: protect-rewrite
/analytics  → 404    x-clerk-auth-reason: protect-rewrite
/sign-in    → 200
```

A visitor never discovers that a sign-in page exists. This is the highest-impact defect
in the project.

**F2 — The README's demo link is dead.** `README.md:8` points at
`https://infrasight.aseck.dev/`, which returns `DEPLOYMENT_NOT_FOUND`. The live site is
`https://www.infrasight.org/`.

**F3 — The 404 page is unstyled.** `app/not-found.tsx` renders hardcoded `bg-gray-100`
with "Could not find requested resource". No dark mode, no navigation, no theme tokens.
Because of F1, this is the *only* page most visitors ever see.

**F4 — The dashboard displays fabricated numbers.** `app/page.tsx:44-50`:

```typescript
const energyUsage = '4.2 MWh';
const devicesTrend = { value: 12, isPositive: true };
const alertsTrend = { value: 2, isPositive: false };
const efficiencyTrend = { value: 1, isPositive: false };
const energyTrend = { value: 5, isPositive: false };
```

All four stat cards show trend arrows that never move. `useEnergyAnalytics` already
exists in `lib/query/hooks/` and is never called.

**F5 — Nothing is deep-linkable.** There are no dynamic page routes outside sign-in and
sign-up. Device detail is a modal, so there is no shareable device URL, no browser back,
and no refresh-in-place.

**F6 — Orphaned code.** `components/AlertsPanel.tsx` and
`components/CriticalDevicesList.tsx` are imported nowhere. `lib/deprecated/migration/`
still ships.

**F7 — No alerting.** Anomalies are detected and health is scored, but there is no
threshold definition, no acknowledge/resolve workflow, no alert history, and no
notification delivery.

**F8 — The README is 370 lines and duplicates existing docs.** Environment Setup
duplicates `docs/environment.md` (817 lines); API Overview duplicates `docs/api-v2.md`
(1,453 lines); Deployment overlaps `docs/runbook.md` (803 lines). There are zero
screenshots in the repository.

## Phase 1 — Make it reachable

Nothing else matters until this ships.

### 1.1 Redirect signed-out users to sign-in

Change `auth.protect()` in `proxy.ts` to `auth.protect({ unauthenticatedUrl })` pointing
at `/sign-in`, so signed-out visitors reach the sign-in page instead of a 404.

*Acceptance:* `curl -sI https://<host>/devices` returns a 307 to `/sign-in`, not a 404.

### 1.2 Fix the README demo URL

Replace `infrasight.aseck.dev` with `www.infrasight.org` in `README.md:8`.

### 1.3 Style the 404 page

Rewrite `app/not-found.tsx` using theme tokens (`bg-background`, `text-foreground`) so it
respects dark mode and matches the app. Include navigation back to the dashboard.

### 1.4 Public read-only demo mode

Approach: an environment-flagged anonymous demo, chosen over a shared demo account
because it costs the visitor zero clicks and avoids putting credentials in the client
bundle.

- Add `DEMO_MODE` (server) and `NEXT_PUBLIC_DEMO_MODE` (client) environment variables.
- In `proxy.ts`, when `DEMO_MODE` is on, allow unauthenticated access to page routes and
  to `GET` API routes. Non-`GET` methods continue to require a real session.
- In `lib/auth/index.ts`, `getAuthContext()` returns a synthetic context
  (`{ userId: 'demo', orgRole: 'org:member' }`) when there is no session and `DEMO_MODE`
  is on.

The critical property: every mutation in the app already routes through `requireAdmin()`
(`lib/auth/index.ts:77`), which throws for `org:member`. Write-blocking is therefore
enforced by existing, already-tested code rather than by new logic.

*Acceptance:* an anonymous request to `GET /api/v2/devices` returns 200; an anonymous
`POST /api/v2/devices` returns 403; both assertions covered by integration tests.

#### Admin-gated read endpoints

Three read endpoints are `requireAdmin()`-gated and will 403 for the synthetic demo
context: `GET /api/v2/audit`, `GET /api/v2/metrics`, and
`GET /api/v2/devices/[id]/history`. This matters because `AuditLogViewer` is rendered
inside `DeviceDetailModal`, so a demo visitor opening any device would hit a failed audit
panel.

Resolution: audit history is read-only and contains no secrets, and it is one of the more
interesting things to show a visitor. Relax `GET /api/v2/devices/[id]/history` and
`GET /api/v2/audit` to `requireOrgMembership()` so the demo context can read them.
Leave `GET /api/v2/metrics` admin-only — Prometheus output is operational surface, not
product surface — and hide the control that reaches it when it is not accessible.

### 1.5 Demo mode UI affordances

Currently `useRbac()` returning `isAdmin: false` hides admin controls entirely
(`app/page.tsx:89`), so a demo visitor never learns that Create Device, Schedule
Maintenance, and Generate Report exist.

- Render admin-gated controls **disabled with a tooltip** rather than hidden when
  `NEXT_PUBLIC_DEMO_MODE` is on: "Admin only · this is a read-only demo".
- Add a dismissible banner identifying the deployment as a public read-only demo, with a
  link to the GitHub repo.

## Phase 2 — Stop lying on the first screen

### 2.1 Real energy number

Replace the hardcoded `'4.2 MWh'` with `useEnergyAnalytics({ aggregation: 'sum' })`,
which already exists. Format the result and show a loading state consistent with the
other cards.

### 2.2 Real trends, or none

Compute the four stat-card deltas as period-over-period comparisons from real data. Where
a real comparison is not available, remove the trend indicator rather than invent one. A
stat card with no arrow is honest; one with a frozen arrow is not.

### 2.3 Confirm live data is flowing

The dashboard headline is "real-time". Verify the external scheduler is successfully
hitting `/api/v2/cron/simulate` against production and that readings are landing within
the last few minutes. A real-time dashboard showing static data is worse than no demo.

## Phase 3 — Make it feel like a tool

### 3.1 Deep-linkable device pages

Add `app/devices/[id]/page.tsx` — a real route showing device detail, recent readings,
audit history, and temperature correlation. Keep the modal for quick inspection from the
grid, but give the page a canonical URL so device links are shareable and survive
refresh.

### 3.2 URL-synced filters

Sync the filter and search state on `/devices` to query parameters so a filtered view is
a shareable link and browser back works.

### 3.3 Resolve orphaned code

Wire `AlertsPanel` and `CriticalDevicesList` into a page or delete them. Delete
`lib/deprecated/migration/`.

## Phase 4 — Alerting

The largest build and the strongest interview talking point. Its absence is what makes
the project read as a dashboard rather than an operations tool.

Scope sketch — **this phase gets its own design doc before implementation**, since it
introduces a new model, an evaluation path, and a notification surface:

- An `AlertRule` model: device selector, metric, comparison, threshold, duration,
  severity.
- Rule evaluation on the ingestion path.
- An alert lifecycle with explicit states: firing → acknowledged → resolved, with the
  same audit-trail treatment `DeviceV2` and `ScheduleV2` already use.
- An alerts page with active and historical views.
- Notification delivery — Pusher toast at minimum, since Pusher is already wired.

## Phase 5 — Packaging

### 5.1 Screenshots

The single largest README gap. Capture the dashboard, floor plan, and device detail, plus
a short GIF of readings updating live. Commit them to the repository rather than hosting
externally.

### 5.2 README rewrite

Target roughly 90 lines: banner, badges with the corrected demo link, a one-sentence
pitch, screenshots, a "What's interesting here" section of four or five bullets that each
link into real code, the tech stack table, and links out to the docs.

Candidate highlights: timeseries bucketing on low-cardinality metadata
(`models/v2/ReadingV2.ts`), a single RBAC guard gating every mutation (`lib/auth/`),
cache-aside with automatic invalidation (`lib/cache/`), and 2,020 test cases across unit,
integration, and E2E layers.

### 5.3 CONTRIBUTING.md

Move Quick Start, Available Scripts, Project Structure, Deployment, and Contributing into
a new `CONTRIBUTING.md`. Reduce the environment, API, and deployment sections to pointers
at `docs/environment.md`, `docs/api-v2.md`, and `docs/runbook.md` instead of duplicating
them.

## Phase 6 — Discoverability and SEO

**Blocked on Phase 1.** Every route currently returns 404 to signed-out clients, and
Googlebot is a signed-out client. No amount of metadata work matters until crawlers can
render a page.

### Root cause: the root layout is a client component

`app/layout.tsx:1` is `'use client'`. A client root layout cannot export `metadata` or
`generateMetadata`, which is why the title and description are hand-written raw `<title>`
and `<meta>` tags inside `<head>` (`app/layout.tsx:32-38`) instead of using the Metadata
API. Every other item in this phase is blocked on fixing it.

Every page file — `app/page.tsx`, `app/devices/page.tsx`, `app/analytics/page.tsx`,
`app/floor-plan/page.tsx`, `app/maintenance/page.tsx` — is also `'use client'`, so none of
them can export per-route metadata either.

### 6.1 Convert the root layout to a server component

Extract the provider stack (`QueryClientProvider`, `ThemeProvider`, `ClerkThemeProvider`,
`PusherProvider`, `ToastContainer`) into a single `'use client'` `<Providers>` component,
leaving `app/layout.tsx` as a server component that exports `metadata`. This also stops
forcing the entire tree to client-render.

*Acceptance:* `app/layout.tsx` has no `'use client'` directive and exports a `Metadata`
object; the app renders and all providers still function.

### 6.2 Configure the Metadata API

Set `metadataBase`, a title template (`%s · Infrasight`), a real description, keywords,
authors, and canonical URLs. The apex already 307s to `www`, so canonicals should point at
`https://www.infrasight.org`.

### 6.3 Open Graph and Twitter cards

Verified against production: the only social tag currently served is
`<meta name="description">`. There are no `og:` or `twitter:` tags at all, so the link
renders as a bare URL everywhere it is shared — LinkedIn, Slack, iMessage, email to a
recruiter.

For a portfolio project the shared link *is* the pitch, so this is disproportionately
valuable. Add full Open Graph and Twitter card metadata plus an `app/opengraph-image`
route so the preview card shows the actual dashboard.

### 6.4 robots.txt and sitemap.xml

Both currently 404 in production. Add `app/robots.ts` and `app/sitemap.ts` covering the
public routes. Once live, submit the sitemap through Google Search Console and confirm
pages actually index — the point is showing up in a search for the author's name.

### 6.5 Per-route metadata

Give each route a distinct title and description rather than every page being
"InfraSight". Requires the same server/client split as 6.1 — either a server `page.tsx`
that exports `metadata` and renders a client child, or route-level `layout.tsx` files.

## Sequencing

Phases 1 and 2 are small and carry nearly all the value for the stated goal; they should
ship together. Phase 3 is a moderate build. Phase 4 is the largest and needs its own
spec. Phase 5 can ship at any point after screenshots exist, and is worth doing early
because most viewers judge from GitHub without ever clicking the demo.

Phase 6 is blocked on Phase 1 but independent of Phases 2 through 5. Within it, 6.1 is an
enabler that blocks 6.2 through 6.5. Phases 5 and 6 share an asset: the screenshots from
5.1 are also the source for the Open Graph image in 6.3.

## Decisions made

- Demo visitors get read-only access, not write access with a nightly reset.
- Demo mode is an anonymous environment-flagged bypass, not a shared demo account.
- Admin controls are shown-but-disabled in demo mode rather than hidden.
- Fabricated trend indicators are removed rather than replaced with plausible fakes.

## Out of scope

Multi-tenancy, per-visitor data isolation, writable demo sessions, and any redesign of
the existing v2 API surface.
