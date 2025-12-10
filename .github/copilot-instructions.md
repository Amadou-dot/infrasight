# AI Coding Agent Instructions for Infrasight

## Project Overview

**Infrasight** is a real-time IoT sensor monitoring dashboard for building management, built with **Next.js 15** (Turbopack), **TypeScript**, **MongoDB** (Mongoose timeseries), and **Pusher** for real-time updates. It tracks environmental sensors (temperature, humidity, occupancy, power) across building floors and rooms.

## Architecture

### Core Data Flow
1. **Sensors** → MongoDB collections (`devices`, `readings`)
2. **API Routes** (Next.js) → Query data, validate with custom logic
3. **Pusher** → Real-time broadcasts to dashboard
4. **React Components** → Display device grid, floor plans, anomaly charts

### Key Services
- **Database**: MongoDB with Mongoose ODM; `readings` collection uses timeseries schema with 7-day auto-expiry
- **Real-time**: Pusher singleton pattern for client subscriptions
- **Frontend**: React 19 with TanStack Table for device grid, Recharts for analytics
- **UI**: shadcn/ui components with Tailwind CSS 4

### Collections & Models
- **Device** (`devices`): metadata about sensors (location, type, config, status)
  - Custom string ID format: `device_001`, `device_002`, etc.
  - Enums: `type` (temperature, humidity, occupancy, power), `status` (active, maintenance, offline)
- **Reading** (`readings`): timeseries data points with auto-expiry
  - Grouped by `metadata.device_id` and `metadata.type`
  - Indexed TTL (expireAfterSeconds: 604800 = 7 days)

## Production Migration Plan

The project uses an **Expand-Contract pattern** for zero-downtime schema upgrades:
- **Phase 1**: Create `devices_v2`, `readings_v2` collections with enhanced fields (audit trails, health metrics, compliance)
- **Phase 2**: Build `/api/v2/*` endpoints; dual-write v1→v2 during transition
- **Phase 3**: Migrate dashboard to v2; deprecate v1

See `plan.md` for full implementation roadmap.

## Development Workflows

### Setup
```bash
pnpm install
cp example.env .env.local  # Add MONGODB_URI, PUSHER_* credentials
```

### Running
```bash
pnpm dev              # Start with Turbopack; opens http://localhost:3000
pnpm build           # Production build with Turbopack
pnpm start           # Run production server
```

### Database Operations
```bash
pnpm seed            # Populate 50 test devices with random metadata (scripts/seed.ts)
pnpm simulate        # Generate synthetic readings to test real-time pipeline
npm run lint         # ESLint check (eslint.config.mjs)
```

### Key Environment Variables
- `MONGODB_URI`: MongoDB connection string (required, errors if missing in `lib/db.ts`)
- `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`: Real-time broadcasting (required)
- `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`: Client-side (must be public)

## Code Patterns & Conventions

### API Routes
- Located in `app/api/*` following Next.js file-based routing
- Pattern: Extract query params → validate → query DB → return JSON
- Example validation in `app/api/devices/route.ts`:
  - Floor param: numeric, ≥1
  - Status param: enum validation against allowed values
  - Sort param: `field:asc|desc` format parsed and applied to Mongoose `.sort()`
- **Error handling**: Generic 500 catches with console.error; no custom error types currently used
- **No authentication**: V1 APIs are open; auth planned for v2

### Models & Validation
- **Custom ID format**: Use string IDs like `device_001` (set explicitly in code, not auto-generated)
- **Mongoose setup**: Prevent model recompilation in dev with `mongoose.models.Device || mongoose.model()` pattern
- **Timeseries**: Reading model uses MongoDB timeseries compression; granularity = 'seconds'
- **Validation**: Currently manual in route handlers; **Zod planned for v2** (available in package.json but unused)

### Frontend Components
- **'use client' directive**: All interactive components marked for client-side rendering
- **State management**: useState + useEffect; no Redux/Zustand
- **Real-time subscriptions**: Use Pusher singleton, subscribe to channels in useEffect
- **TanStack Table**: Used in `DeviceGrid.tsx` for sorting, filtering, mobile collapsible rows
- **Responsive design**: Mobile-first with conditional rendering (expand/collapse cards on small screens)
- **Toast notifications**: react-toastify with centered position, auto-close disabled

### Database Connection
- **Connection pooling**: Global cached connection in `lib/db.ts` to prevent hot-reload exhaustion
- **Timeouts**: serverSelectionTimeoutMS = 5s, socketTimeoutMS = 45s
- **Error propagation**: Throws on connection failure; caught by route handlers

## Critical Integration Points

### Pusher Real-time Flow
1. Backend publishes via `pusherServer.trigger(channel, event, data)`
2. Frontend subscribes via `pusherClient.subscribe(channel).bind(event, handler)`
3. **Channel naming convention**: None formally defined yet; examples use device IDs
4. **Data shape**: Events broadcast `PusherReading` objects with metadata.device_id, timestamp, value

### API Response Contracts
- Devices: Array of Device objects
- Latest readings: Aggregation result with `_id` (device_id), `value`, `timestamp`, `type`
- No wrapper format; raw JSON arrays/objects

## Project Structure Notes

- `components/ui/`: shadcn-provided Radix UI wrappers (button, card, badge, etc.)
- `scripts/`: One-off utilities (seed.ts, simulate.ts, setup-ttl.ts)
- `lib/utils.ts`: Shared utilities (cn() for clsx + tailwind-merge)
- No `pages/` directory; uses App Router (`app/` dir)
- Path alias `@/*` maps to workspace root for clean imports

## Avoid Common Pitfalls

1. **Model recompilation**: Always use mongoose.models check or model will fail in dev hot-reload
2. **Missing env vars**: Pusher and MongoDB URI are checked at import time; failures are loud and immediate
3. **Timeseries compression**: Don't modify Reading schema without understanding MongoDB timeseries constraints
4. **Custom IDs**: Device._id is NOT auto-generated; must be set when creating records (see seed.ts)
5. **Client-side Pusher config**: Use `NEXT_PUBLIC_*` prefix; avoid server secrets in browser code
6. **Real-time sync**: Pusher broadcasts don't persist—subscribe on component mount; design for eventual consistency

## Recommended Next Steps for Enhancement

1. Add Zod validation schemas in `/lib/validations/` (already in package.json)
2. Create unified error response type for consistency
3. Add API request logging middleware
4. Implement rate limiting (Redis-based, as noted in plan.md)
5. Setup monitoring/observability for sensor health metrics
6. Document Pusher channel naming convention once finalized
