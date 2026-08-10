# Contributing to Infrasight

This file is the complete path from `git clone` to a running app and a green test suite. The deep references live in [docs/](docs/) — this file links to them instead of repeating them.

## Prerequisites

- Node.js 18+ and [pnpm](https://pnpm.io/)
- A MongoDB database — local, or a free [Atlas](https://www.mongodb.com/cloud/atlas) cluster
- A [Pusher Channels](https://pusher.com/) app (free tier) for real-time updates
- A [Clerk](https://clerk.com/) application (free tier) for authentication
- Optional: Redis ([Upstash](https://upstash.com/) or local) for caching and rate limiting, and [Sentry](https://sentry.io/) for error tracking — the app runs without both

## Setup

```bash
git clone https://github.com/Amadou-dot/infrasight.git
cd infrasight
pnpm install
cp example.env .env.local
```

Then fill in `.env.local`. The required blocks are:

- `MONGODB_URI` — your connection string
- `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` and the matching `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER` — from your Pusher app's keys page
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, the four `NEXT_PUBLIC_CLERK_*_URL` routes, and `CLERK_ALLOWED_ORG_SLUGS` / `NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS` — from your Clerk dashboard; create an organization whose slug matches the allowlist and join it, or the app will send you to `/unauthorized`
- `SEED_SECRET` — any long random string; it authenticates `GET /api/v2/cron/simulate`

Every variable — including the optional Redis, Sentry, metrics, demo-mode, and alerting knobs — is documented with failure modes in [docs/environment.md](docs/environment.md).

## Initialize and run

```bash
pnpm create-indexes-v2   # create MongoDB indexes (required once per database)
pnpm seed                # populate 500 devices + readings
pnpm dev                 # http://localhost:3000
```

Sign in through Clerk and you should see a populated dashboard. To watch live updates, generate readings:

```bash
curl -H "Authorization: Bearer $SEED_SECRET" http://localhost:3000/api/v2/cron/simulate
```

## Available scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm seed` | Seed 500 test devices + readings |
| `pnpm simulate` | Generate synthetic readings continuously |
| `pnpm create-indexes-v2` / `pnpm verify-indexes` | Create / verify MongoDB indexes |
| `pnpm test` | All Jest tests |
| `pnpm test:unit` / `pnpm test:integration` | One Jest layer |
| `pnpm test:coverage` | Jest with coverage report |
| `pnpm test:e2e` / `pnpm test:e2e:ui` | Playwright E2E / UI mode |
| `pnpm test:api` | Exercise the live v2 API |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |

## Project layout

```
app/               Pages (App Router) and API routes under app/api/v2/
components/        React components ('use client')
lib/               Auth/RBAC, validations, alerting, cache, realtime, monitoring
models/v2/         Mongoose models (devices, readings, schedules, alert rules, alerts)
scripts/v2/        Seeding, simulation, index management
types/v2/          API contract types
__tests__/         Jest unit + integration suites
e2e/               Playwright suites
proxy.ts           Clerk middleware — route protection and org gating
```

Schema and index details are in [docs/models-v2.md](docs/models-v2.md); the endpoint reference is [docs/api-v2.md](docs/api-v2.md).

## Testing

Run `pnpm test` before pushing. Coverage thresholds (80% statements, 70% branches, 75% functions, 80% lines) are enforced in CI, and types and lint gate merges alongside tests. E2E tests bypass Clerk when `E2E_TESTING=true` is set in `.env.local`. Strategy and conventions: [docs/testing-v2.md](docs/testing-v2.md).

## Deployment

The app deploys as a standard Next.js project on [Vercel](https://vercel.com) — import the repo, set the environment variables, deploy. Production checklist, monitoring, and incident response live in the [operational runbook](docs/runbook.md).

## Contribution workflow

1. Fork and create a feature branch (`git checkout -b feature/thing`)
2. Make your change, with tests
3. Keep the conventions: Zod validation on every input, `withErrorHandler` + `jsonSuccess`/`jsonPaginated` in API routes, `requireAdmin()` on mutations, `requireOrgMembership()` on reads
4. Run `pnpm lint` and `pnpm test`
5. Open a pull request
