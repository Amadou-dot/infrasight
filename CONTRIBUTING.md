# Contributing to Infrasight

Use this guide to run Infrasight locally and check a change before opening a pull request.

## Prerequisites

- Node.js 22.13 or later in the 22.x line and pnpm 11 match the [CI workflow](.github/workflows/test-coverage.yml).
- Use a local MongoDB database for the sample fleet. The app also supports [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
- Configure a [Pusher Channels](https://pusher.com/) app for live updates and a [Clerk](https://clerk.com/) application with an organization for sign-in.
- Redis (local or [Upstash](https://upstash.com/)) enables caching and rate limiting. [Sentry](https://sentry.io/) adds error tracking. Both are optional.

## Setup

```bash
git clone https://github.com/Amadou-dot/infrasight.git
cd infrasight
pnpm install --frozen-lockfile
cp example.env .env.local
```

Configure these values in `.env.local`. The [environment guide](docs/environment.md) covers the optional settings and troubleshooting.

| Setting                                                          | Local configuration                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                                                    | Use a dedicated database such as `mongodb://127.0.0.1:27017/infrasight_dev`.                                                     |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | Copy the credentials from your Pusher app. Set `NEXT_PUBLIC_PUSHER_KEY` and `NEXT_PUBLIC_PUSHER_CLUSTER` to the matching values. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`          | Use a Clerk development application. The example file includes the sign-in, sign-up, and redirect routes.                        |
| `CLERK_ALLOWED_ORG_SLUGS`, `NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS` | Set both to the slug of your development organization. Join that organization and make it active when signed in.                 |
| `SEED_SECRET`                                                    | Choose a random secret for the simulator endpoint. The scheduler sends this value as a bearer token.                             |

## Initialize and run

Run the seed before the index script on a fresh local database. This lets Mongoose create the time-series readings collection with its seven-day retention period. The seed clears devices, readings, alert rules, and alerts before loading the sample fleet (500 devices by default).

```bash
pnpm seed
pnpm create-indexes-v2
pnpm dev
```

Sign in at [localhost:3000](http://localhost:3000). To see new readings on the floor plan, set `SEED_SECRET` in a second terminal to the value from `.env.local`, then request one simulation cycle.

```bash
curl --fail --show-error -H "Authorization: Bearer $SEED_SECRET" http://localhost:3000/api/v2/cron/simulate
```

## Available scripts

| Command                                          | Purpose                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm dev`                                       | Start the Next.js development server with Turbopack                             |
| `pnpm build` / `pnpm start`                      | Build the production app and serve the build                                    |
| `pnpm seed`                                      | Replace the sample fleet, readings, and alert rules in the development database |
| `pnpm simulate`                                  | Write simulated readings to the database every five seconds                     |
| `pnpm create-indexes-v2` / `pnpm verify-indexes` | Create or inspect MongoDB indexes                                               |
| `pnpm test` / `pnpm test:coverage`               | Run Jest, optionally with the coverage checks                                   |
| `pnpm test:unit` / `pnpm test:integration`       | Run just the unit or integration tests                                          |
| `pnpm test:e2e` / `pnpm test:e2e:ui`             | Run Playwright from the terminal or in UI mode                                  |
| `pnpm test:api`                                  | Exercise v2 endpoints against a running server, including writes                |
| `pnpm lint` / `pnpm lint:fix`                    | Check ESLint rules or apply fixes                                               |
| `pnpm format:check` / `pnpm format`              | Check Prettier formatting or apply it                                           |

## Project layout

```text
app/               App Router pages and v2 API routes under app/api/v2/
components/        Dashboard, floor plan, device, and alert interfaces
lib/               Authorization, validation, alerting, caching, live updates, and monitoring
models/v2/         Mongoose models for devices, readings, schedules, rules, and alerts
scripts/v2/        Seeding, simulation, and index management
types/v2/          API contract types
__tests__/         Jest unit and integration suites
e2e/               Playwright browser tests
proxy.ts           Clerk middleware and organization checks
```

See the [data model guide](docs/models-v2.md) for schemas and indexes and the [API reference](docs/api-v2.md) for endpoint contracts.

## Testing

Run the same checks as CI before opening a pull request.

```bash
pnpm exec tsc --noEmit
pnpm exec eslint .
pnpm test:coverage
```

Jest requires 75% coverage for statements and lines, and 55% for branches and functions. Its database tests start a disposable MongoDB server. [Jest configuration](jest.config.js) · [CI workflow](.github/workflows/test-coverage.yml)

For browser tests, configure your Clerk development keys and run `pnpm test:e2e`. Playwright starts its local server with `E2E_TESTING=true` to bypass the proxy check. Route handlers still enforce their own authorization. [Playwright configuration](playwright.config.ts) · [Testing guide](docs/testing-v2.md)

## Deployment

Import the repository into [Vercel](https://vercel.com), configure the environment variables, and deploy it as a Next.js project. The [operational runbook](docs/runbook.md) covers monitoring, incident response, and rollback.

## Contribution workflow

1. Fork the repository and create a branch for your change.
2. Add tests for the behavior you change. In the v2 API, validate request data with Zod, wrap the handler in `withErrorHandler`, and use `jsonSuccess` or `jsonPaginated` for JSON responses.
3. Preserve the endpoint’s authorization contract. For example, reading the device inventory requires membership, editing a device requires an organization administrator, and the simulator authenticates its scheduler with `SEED_SECRET`. [Role checks](lib/auth/) · [Simulator route](app/api/v2/cron/simulate/route.ts)
4. Run the [checks](#testing) and open a pull request describing the change and its validation.
