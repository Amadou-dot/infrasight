<p>
  <img src="https://raw.githubusercontent.com/Amadou-dot/Amadou-dot/main/assets/banners/infrasight-banner.png">
</p>

<h1>Infrasight - Real-Time IoT Building Monitoring Dashboard</h1>

<p>
  <a href="https://infrasight.aseck.dev/">
    <img src="https://img.shields.io/badge/Live%20Preview-000000?style=for-the-badge&logo=vercel&logoColor=white">
  </a>

  <img src="https://img.shields.io/badge/Next.js%2015-000000?style=for-the-badge&logo=nextdotjs&logoColor=white">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white">
  <img src="https://img.shields.io/badge/Pusher-300D4F?style=for-the-badge&logo=pusher&logoColor=white">
  <!-- NOTE: After setting up Codecov for this repository, replace YOUR_USERNAME and YOUR_TOKEN in the badge URLs below with the actual GitHub username/organization and Codecov token. -->
  <a href="https://codecov.io/gh/YOUR_USERNAME/infrasight">
    <img src="https://codecov.io/gh/YOUR_USERNAME/infrasight/branch/main/graph/badge.svg?token=YOUR_TOKEN" alt="Coverage">
  </a>
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
- **Multi-Sensor Support**: Temperature, humidity, CO2, power, occupancy, and more

### V2 Enhancements

- **90-Day Data Retention**: Automatic TTL-based cleanup of historical readings
- **Comprehensive Audit Trails**: Complete change history for all devices
- **Device Health Scoring**: Calculated health metrics with predictive indicators
- **Predictive Maintenance**: Forecasting for maintenance scheduling
- **Temperature Correlation**: Cross-device temperature analysis
- **Enhanced Anomaly Detection**: ML-based anomaly scoring and trends

### Security & Performance

- **Rate Limiting**: Configurable limits for API protection
- **Caching**: Redis-backed response caching
- **Zod Validation**: Type-safe input validation on all endpoints
- **Error Handling**: Consistent error codes and responses
- **Sentry Integration**: Error tracking and performance monitoring

---

## Tech Stack

| Category          | Technologies                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**      | [Next.js 15](https://nextjs.org/) with [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/) |
| **Backend**       | [MongoDB](https://www.mongodb.com/) with [Mongoose](https://mongoosejs.com/) (timeseries collections)                                                          |
| **Validation**    | [Zod](https://zod.dev/) for schema validation                                                                                                                  |
| **Real-Time**     | [Pusher](https://pusher.com/) for WebSocket connections                                                                                                        |
| **Caching**       | [Redis](https://redis.io/) / [Upstash](https://upstash.com/)                                                                                                   |
| **UI Components** | [Radix UI](https://www.radix-ui.com/), [shadcn/ui](https://ui.shadcn.com/)                                                                                     |
| **Charts**        | [Recharts](https://recharts.org/) for data visualization                                                                                                       |
| **Monitoring**    | [Sentry](https://sentry.io/) for error tracking                                                                                                                |

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
- (Optional) [Redis](https://redis.io/) / [Upstash](https://upstash.com/) for rate limiting

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
| `pnpm lint`              | Run ESLint                              |

---

## Project Structure

```
infrasight/
├── app/                    # Next.js App Router
│   ├── api/v2/            # V2 API routes
│   └── page.tsx           # Dashboard page
├── components/            # React components
│   ├── DeviceGrid.tsx     # Device list grid
│   ├── FloorPlan.tsx      # Interactive floor plan
│   └── ...
├── docs/                  # Documentation
│   ├── api-v2.md          # API reference
│   ├── models-v2.md       # Data models
│   ├── environment.md     # Configuration
│   ├── testing-v2.md      # Testing guide
│   └── runbook.md         # Operations
├── lib/                   # Utilities
│   ├── api/               # API client and response helpers
│   ├── errors/            # Error handling
│   ├── validations/v2/    # Zod schemas
│   └── db.ts              # Database connection
├── models/v2/             # Mongoose models
│   ├── DeviceV2.ts        # Device model
│   └── ReadingV2.ts       # Reading model (timeseries)
├── scripts/v2/            # Database scripts
│   ├── seed-v2.ts         # Seed data
│   └── simulate.ts        # Reading simulation
└── types/v2/              # TypeScript types
```

---

## API Overview

### Core Endpoints

| Method | Endpoint                  | Description                 |
| ------ | ------------------------- | --------------------------- |
| GET    | `/api/v2/devices`         | List devices with filtering |
| POST   | `/api/v2/devices`         | Create a new device         |
| GET    | `/api/v2/devices/:id`     | Get device details          |
| PATCH  | `/api/v2/devices/:id`     | Update a device             |
| DELETE | `/api/v2/devices/:id`     | Soft delete a device        |
| GET    | `/api/v2/readings`        | Query readings              |
| POST   | `/api/v2/readings/ingest` | Bulk ingest readings        |
| GET    | `/api/v2/readings/latest` | Get latest readings         |

### Analytics Endpoints

| Method | Endpoint                                    | Description             |
| ------ | ------------------------------------------- | ----------------------- |
| GET    | `/api/v2/analytics/health`                  | Device health metrics   |
| GET    | `/api/v2/analytics/energy`                  | Energy consumption      |
| GET    | `/api/v2/analytics/anomalies`               | Anomaly detection       |
| GET    | `/api/v2/analytics/maintenance-forecast`    | Maintenance predictions |
| GET    | `/api/v2/analytics/temperature-correlation` | Temperature analysis    |

See [API Documentation](./docs/api-v2.md) for complete reference.

---

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Configure environment variables
4. Deploy

### Docker

```bash
# Build image
docker build -t infrasight .

# Run container
docker run -p 3000:3000 --env-file .env.production infrasight
```

### Production Checklist

- [ ] Configure MongoDB Atlas with proper security
- [ ] Set up Pusher production credentials
- [ ] Configure Redis/Upstash for rate limiting
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
