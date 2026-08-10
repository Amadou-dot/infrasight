<p align="center">
  <img src="https://raw.githubusercontent.com/Amadou-dot/Amadou-dot/main/assets/banners/infrasight-banner.png" alt="Infrasight banner">
</p>

<p align="center">
  <a href="https://www.infrasight.org/">
    <img src="https://img.shields.io/badge/Live%20Demo-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Live demo">
  </a>
  <img src="https://img.shields.io/badge/Next.js%2016-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js 16">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/Pusher-300D4F?style=for-the-badge&logo=pusher&logoColor=white" alt="Pusher">
  <img src="https://img.shields.io/badge/Clerk-6C47FF?style=for-the-badge&logo=clerk&logoColor=white" alt="Clerk">
</p>

Real-time IoT monitoring for building management: 500 sensors across floors and rooms, streamed over WebSockets into a dashboard with threshold alerting, anomaly detection, and predictive maintenance.

**[Try the live demo](https://www.infrasight.org/)** — it's a public, read-only tour. No signup.

![Dashboard — system overview with open alerts, health score, and anomaly detection](public/screenshots/dashboard.png)

Readings arrive live — the floor plan below is receiving them over Pusher, with threshold alerts firing as toasts:

![Live floor plan updating in real time as sensor readings arrive](public/screenshots/live-updates.gif)

## What's interesting here

- **Timeseries bucketing on low-cardinality metadata.** Readings live in a MongoDB timeseries collection whose bucketing key is a deliberately tiny metadata document (device, type, unit, source) — cardinality discipline the schema comments explain and the 7-day TTL depends on. See [models/v2/ReadingV2.ts](models/v2/ReadingV2.ts).
- **One RBAC gate in front of every mutation.** All writes route through `requireAdmin()` in [lib/auth/](lib/auth/), so the public demo gets write-blocking for free: anonymous visitors receive a synthetic member context and the existing, already-tested gate does the rest.
- **Alerting with a real lifecycle.** Threshold rules are evaluated on the ingest path; episodes move `pending → firing → acknowledged → resolved` through a state machine that deletes never-fired episodes and enforces its invariants at every write ([lib/alerting/](lib/alerting/), [models/v2/AlertV2.ts](models/v2/AlertV2.ts)), with a staleness sweep for devices that silently stop reporting.
- **Realtime that respects transport limits.** Reading broadcasts are trimmed to the wire shape and chunked under Pusher's 10 KB event cap ([lib/pusher-readings.ts](lib/pusher-readings.ts)); alert envelopes degrade to a storm summary instead of flooding ([lib/alerting/notify.ts](lib/alerting/notify.ts)); the private channel's auth endpoint signs an allow-list, not arbitrary channel names ([app/api/pusher/auth/route.ts](app/api/pusher/auth/route.ts)).
- **2,800+ test cases** across unit, integration, and E2E layers ([__tests__/](__tests__/), [e2e/](e2e/)), with coverage thresholds enforced in CI.

<details>
<summary><b>More screens</b> — devices, device detail, alerts, floor plan</summary>

| | |
| --- | --- |
| ![Device inventory](public/screenshots/devices-page.png) | ![Device detail with audit trail](public/screenshots/device-details-modal.png) |
| ![Alerts with real-time toasts](public/screenshots/alerts-page.png) | ![Floor plan](public/screenshots/floor-plan.png) |
| ![Device readings and temperature correlation](public/screenshots/device-readings.png) | ![Alert rule builder](public/screenshots/new-alert-rule-modal.png) |

</details>

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | [Next.js 16](https://nextjs.org/) (App Router, Turbopack), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/) |
| Data | [MongoDB](https://www.mongodb.com/) timeseries via [Mongoose](https://mongoosejs.com/), [Redis](https://redis.io/)/[Upstash](https://upstash.com/) cache-aside with automatic invalidation ([lib/cache/](lib/cache/)) |
| Realtime | [Pusher](https://pusher.com/) — public readings channel + authorized private alerts channel |
| Auth | [Clerk](https://clerk.com/) with organization-based RBAC |
| API | 33 v2 endpoints, [Zod](https://zod.dev/)-validated, rate-limited, with Prometheus metrics and PDF reporting |
| State | [TanStack Query](https://tanstack.com/query) with typed API client and hooks |
| Observability | [Sentry](https://sentry.io/), structured logging, request tracing |

## Documentation

| Document | Covers |
| --- | --- |
| [API Reference](docs/api-v2.md) | All v2 endpoints, request/response contracts |
| [Data Models](docs/models-v2.md) | Schemas, indexes, timeseries constraints |
| [Environment](docs/environment.md) | Every variable, what breaks without it |
| [Testing](docs/testing-v2.md) | Strategy, layers, how to run |
| [Runbook](docs/runbook.md) | Deployment, monitoring, incident response |

## Running it locally

Setup, scripts, project layout, and contribution guidelines live in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

---

<p align="center">Made by <a href="https://github.com/Amadou-dot">Amadou</a></p>
