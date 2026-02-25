<p>
  <img src="https://raw.githubusercontent.com/Amadou-dot/Amadou-dot/main/assets/banners/infrasight-banner.png">
</p>

<h1>Infrasight - Real-Time IoT Building Monitoring Dashboard</h1>

<p>
  <a href="https://infrasight.aseck.dev/">
    <img src="https://img.shields.io/badge/Live%20Preview-000000?style=for-the-badge&logo=vercel&logoColor=white">
  </a>

  <img src="https://img.shields.io/badge/Next.js%2016-000000?style=for-the-badge&logo=nextdotjs&logoColor=white">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white">
  <img src="https://img.shields.io/badge/Pusher-300D4F?style=for-the-badge&logo=pusher&logoColor=white">
  <img src="https://img.shields.io/badge/Clerk-6C47FF?style=for-the-badge&logo=clerk&logoColor=white">
</p>

<p>
  A production-ready IoT sensor monitoring dashboard for building management. Track environmental sensors across building floors and rooms with live updates, anomaly detection, predictive maintenance, and comprehensive device health monitoring.
</p>

---

## Features

### Core Monitoring

- **Real-Time Updates**: Live sensor data via Pusher WebSocket connections
- **Device Health Tracking**: Monitor status, uptime, battery levels, and signal strength
- **Floor Plan Visualization**: Interactive floor plans with device status indicators
- **Multi-Sensor Support**: 15 sensor types including temperature, humidity, CO2, power, occupancy, and more

### Authentication & RBAC

- **Clerk Authentication**: Secure sign-in/sign-up with organization-based access control
- **Role-Based Permissions**: Admin (full CRUD) and Member (read-only) roles
- **Organization Gating**: Only users in allowed organizations can access the dashboard

### V2 Enhancements

- **90-Day Data Retention**: Automatic TTL-based cleanup of historical readings
- **Comprehensive Audit Trails**: Complete change history for all devices
- **Device Health Scoring**: Calculated health metrics with predictive indicators
- **Predictive Maintenance**: Forecasting for maintenance scheduling
- **Maintenance Scheduling**: Create, track, and manage maintenance tasks with bulk support and status machine (scheduled/completed/cancelled)
- **PDF Report Generation**: On-demand device health reports with per-building or all-buildings scope
- **Temperature Correlation**: Cross-device temperature analysis
- **Enhanced Anomaly Detection**: ML-based anomaly scoring and trends

### Security & Performance

- **Rate Limiting**: Configurable limits for API protection
- **Caching**: Redis-backed response caching with automatic invalidation
- **Zod Validation**: Type-safe input validation on all endpoints
- **Error Handling**: Consistent error codes and responses
- **Sentry Integration**: Error tracking and performance monitoring
- **Prometheus Metrics**: Request latency, error rates, cache stats, and ingestion metrics

---

## Tech Stack

| Category           | Technologies                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**       | [Next.js 16](https://nextjs.org/) with [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/) |
| **Backend**        | [MongoDB](https://www.mongodb.com/) with [Mongoose](https://mongoosejs.com/) (timeseries collections)                                                          |
| **Authentication** | [Clerk](https://clerk.com/) for authentication & organization-based RBAC                                                                                       |
| **Validation**     | [Zod](https://zod.dev/) for schema validation                                                                                                                  |
| **Real-Time**      | [Pusher](https://pusher.com/) for WebSocket connections                                                                                                        |
| **State**          | [TanStack Query](https://tanstack.com/query) for server state, [TanStack Table](https://tanstack.com/table) for data tables                                    |
| **Caching**        | [Redis](https://redis.io/) / [Upstash](https://upstash.com/)                                                                                                   |
| **UI Components**  | [Radix UI](https://www.radix-ui.com/), [shadcn/ui](https://ui.shadcn.com/)                                                                                     |
| **Charts**         | [Recharts](https://recharts.org/) for data visualization                                                                                                       |
| **PDF**            | [pdf-lib](https://pdf-lib.js.org/) for report generation                                                                                                       |
| **Monitoring**     | [Sentry](https://sentry.io/) for error tracking, Prometheus metrics                                                                                            |

---

## Documentation

| Document                                             | Description                                  |
| ---------------------------------------------------- | -------------------------------------------- |
| [API Documentation](./docs/api-v2.md)                | Complete V2 API reference with examples      |
| [Data Models](./docs/models-v2.md)                   | MongoDB schemas, indexes, and constraints    |
| [Environment Setup](./docs/environment.md)           | Configuration and environment variables      |
| [Testing Guide](./docs/testing-v2.md)                | Testing strategy and implementation          |
| [Test Coverage Setup](./docs/TEST_COVERAGE_SETUP.md) | Coverage reporting and branch protection     |
| [Operational Runbook](./docs/runbook.md)             | Monitoring, debugging, and incident response |

---

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB database (local or [Atlas](https://www.mongodb.com/cloud/atlas))
- [Pusher](https://pusher.com/) account for real-time features
- [Clerk](https://clerk.com/) account for authentication
- (Optional) [Redis](https://redis.io/) / [Upstash](https://upstash.com/) for caching and rate limiting

### Installation

```bash
# Clone the repository
git clone https://github.com/Amadou-dot/infrasight.git
cd infrasight

# Install dependencies
pnpm install
```

### Environment Setup

1. Copy the example environment file:

```bash
cp example.env .env.local
```

2. Configure required variables in `.env.local`:

```env
# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/infrasight

# Pusher (Server-side)
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_key
PUSHER_SECRET=your_secret
PUSHER_CLUSTER=your_cluster

# Pusher (Client-side)
NEXT_PUBLIC_PUSHER_KEY=your_key
NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_publishable_key
CLERK_SECRET_KEY=your_secret_key
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/

# RBAC Organization Access
CLERK_ALLOWED_ORG_SLUGS=users
NEXT_PUBLIC_CLERK_ALLOWED_ORG_SLUGS=users
```

See [Environment Setup Guide](./docs/environment.md) for complete configuration options.

### Initialize & Run

```bash
# Create database indexes
pnpm create-indexes-v2

# Seed with test data (500 devices + readings)
pnpm seed

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

---

## Available Scripts

| Command                  | Description                             |
| ------------------------ | --------------------------------------- |
| `pnpm dev`               | Start development server with Turbopack |
| `pnpm build`             | Build for production                    |
| `pnpm start`             | Start production server                 |
| `pnpm seed`              | Populate database with test data        |
| `pnpm simulate`          | Generate real-time simulated readings   |
| `pnpm create-indexes-v2` | Create MongoDB indexes                  |
| `pnpm verify-indexes`    | Verify index configuration              |
| `pnpm test`              | Run all tests                           |
| `pnpm test:coverage`     | Run tests with coverage report          |
| `pnpm test:unit`         | Run unit tests only                     |
| `pnpm test:integration`  | Run integration tests only              |
| `pnpm test:e2e`          | Run end-to-end tests with Playwright    |
| `pnpm test:api`          | Test V2 API endpoints                   |
| `pnpm lint`              | Run ESLint                              |
| `pnpm lint:fix`          | Auto-fix lint issues                    |
| `pnpm format`            | Format with Prettier                    |
| `pnpm format:check`      | Check formatting                        |

---

## Project Structure

```
infrasight/
├── app/                        # Next.js App Router
│   ├── api/v2/                 # V2 API routes (25 endpoints)
│   │   ├── devices/            # Device CRUD + history
│   │   ├── readings/           # Reading queries + ingest + latest
│   │   ├── analytics/          # Health, energy, anomalies, forecast, correlation
│   │   ├── schedules/          # Maintenance scheduling CRUD
│   │   ├── reports/            # PDF report generation
│   │   ├── audit/              # Cross-device audit trail
│   │   ├── metadata/           # System metadata
│   │   └── metrics/            # Prometheus metrics
│   ├── devices/                # Device list & deleted devices pages
│   ├── analytics/              # Analytics dashboard
│   ├── maintenance/            # Maintenance dashboard
│   ├── floor-plan/             # Floor plan visualization
│   ├── settings/               # User settings
│   ├── sign-in/                # Clerk sign-in
│   ├── sign-up/                # Clerk sign-up
│   └── page.tsx                # Dashboard home page
├── components/                 # React components
│   ├── devices/
│   │   ├── CreateDeviceModal.tsx    # Device creation (admin only)
│   │   └── TagInput.tsx             # Tag input for device metadata
│   ├── ScheduleList.tsx             # Paginated schedule list
│   ├── ScheduleServiceModal.tsx     # Schedule creation (bulk support)
│   ├── ScheduleStatusBadge.tsx      # Status badge component
│   ├── GenerateReportModal.tsx      # PDF report generation
│   └── ...
├── docs/                       # Documentation
├── lib/                        # Utilities
│   ├── api/                    # API client and response helpers
│   ├── auth/                   # RBAC utilities (requireAdmin, requireOrgMembership)
│   ├── cache/                  # Redis caching with invalidation
│   ├── errors/                 # Error handling
│   ├── middleware/              # Request validation, body size, headers
│   ├── monitoring/             # Sentry, Prometheus metrics, logging
│   ├── query/                  # React Query hooks
│   ├── ratelimit/              # Rate limiting config and middleware
│   ├── redis/                  # Redis client configuration
│   ├── validations/v2/         # Zod schemas
│   └── db.ts                   # Database connection
├── models/v2/                  # Mongoose models
│   ├── DeviceV2.ts             # Device model
│   ├── ReadingV2.ts            # Reading model (timeseries)
│   └── ScheduleV2.ts           # Maintenance schedule model
├── scripts/v2/                 # Database scripts
│   ├── seed-v2.ts              # Seed data
│   └── simulate.ts             # Reading simulation
├── types/v2/                   # TypeScript types
│   └── schedule.types.ts       # Schedule types
├── proxy.ts                    # Clerk middleware (route protection)
├── __tests__/                  # Jest test suites
│   ├── unit/                   # Unit tests
│   └── integration/api/        # API integration tests
└── e2e/                        # Playwright E2E tests
```

---

## API Overview

### Device Management

| Method | Endpoint                       | Description            |
| ------ | ------------------------------ | ---------------------- |
| GET    | `/api/v2/devices`              | List/filter devices    |
| POST   | `/api/v2/devices`              | Create a new device    |
| GET    | `/api/v2/devices/:id`          | Get device details     |
| PATCH  | `/api/v2/devices/:id`          | Update a device        |
| DELETE | `/api/v2/devices/:id`          | Soft delete a device   |
| GET    | `/api/v2/devices/:id/history`  | Device audit history   |

### Reading Data

| Method | Endpoint                  | Description          |
| ------ | ------------------------- | -------------------- |
| GET    | `/api/v2/readings`        | Query readings       |
| GET    | `/api/v2/readings/latest` | Get latest readings  |
| POST   | `/api/v2/readings/ingest` | Bulk ingest readings |

### Analytics

| Method | Endpoint                                    | Description             |
| ------ | ------------------------------------------- | ----------------------- |
| GET    | `/api/v2/analytics/health`                  | Device health metrics   |
| GET    | `/api/v2/analytics/energy`                  | Energy consumption      |
| GET    | `/api/v2/analytics/anomalies`               | Anomaly detection       |
| GET    | `/api/v2/analytics/maintenance-forecast`    | Maintenance predictions |
| GET    | `/api/v2/analytics/temperature-correlation` | Temperature analysis    |

### Maintenance Scheduling

| Method | Endpoint                  | Description          |
| ------ | ------------------------- | -------------------- |
| GET    | `/api/v2/schedules`       | List schedules       |
| POST   | `/api/v2/schedules`       | Create schedule(s)   |
| GET    | `/api/v2/schedules/:id`   | Get schedule details |
| PATCH  | `/api/v2/schedules/:id`   | Update schedule      |
| DELETE | `/api/v2/schedules/:id`   | Cancel schedule      |

### Reports & System

| Method | Endpoint                          | Description                |
| ------ | --------------------------------- | -------------------------- |
| GET    | `/api/v2/reports/device-health`   | Generate PDF health report |
| GET    | `/api/v2/audit`                   | Cross-device audit trail   |
| GET    | `/api/v2/metadata`                | System metadata            |
| GET    | `/api/v2/metrics`                 | Prometheus metrics         |

See [API Documentation](./docs/api-v2.md) for complete reference.

---

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Configure environment variables
4. Deploy

### Production Checklist

- [ ] Configure MongoDB Atlas with proper security
- [ ] Set up Pusher production credentials
- [ ] Configure Clerk (organization, roles, allowed org slugs)
- [ ] Configure Redis/Upstash for caching and rate limiting
- [ ] Enable Sentry error tracking
- [ ] Set up API key authentication
- [ ] Configure proper CORS settings
- [ ] Set up monitoring and alerting
- [ ] Create database backup schedule

See [Operational Runbook](./docs/runbook.md) for complete procedures.

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Use TypeScript strict mode
- Validate all inputs with Zod
- Follow the error handling patterns
- Add tests for new features
- Maintain test coverage above thresholds (80% statements, 70% branches, 75% functions, 80% lines)
- Update documentation as needed

See [Testing Guide](./docs/testing-v2.md) for testing requirements and [Test Coverage Setup](./docs/TEST_COVERAGE_SETUP.md) for coverage enforcement.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<p>
  Made by <a href="https://github.com/Amadou-dot">Amadou</a>
</p>
