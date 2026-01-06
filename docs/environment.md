# Infrasight Environment Configuration Guide

Complete guide for configuring environment variables and setting up the Infrasight development and production environments.

## Table of Contents

- [Quick Start](#quick-start)
- [Required Environment Variables](#required-environment-variables)
  - [MongoDB](#mongodb)
  - [Pusher (Real-time)](#pusher-real-time)
- [Optional Environment Variables](#optional-environment-variables)
  - [Redis (Rate Limiting & Caching)](#redis-rate-limiting--caching)
  - [Rate Limiting](#rate-limiting)
  - [Caching](#caching)
  - [Monitoring & Logging](#monitoring--logging)
  - [Sentry Error Tracking](#sentry-error-tracking)
  - [API Authentication](#api-authentication)
  - [Development Options](#development-options)
- [Environment-Specific Configuration](#environment-specific-configuration)
- [Service Setup Guides](#service-setup-guides)
  - [MongoDB Setup](#mongodb-setup)
  - [Pusher Setup](#pusher-setup)
  - [Redis Setup](#redis-setup)
  - [Sentry Setup](#sentry-setup)
- [Validation & Troubleshooting](#validation--troubleshooting)
- [Security Best Practices](#security-best-practices)

---

## Quick Start

1. Copy the example environment file:

```bash
cp example.env .env.local
```

2. Fill in the required variables (minimum configuration):

```env
# Required: MongoDB connection
MONGODB_URI=mongodb://localhost:27017/infrasight

# Required: Pusher (server-side)
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_key
PUSHER_SECRET=your_secret
PUSHER_CLUSTER=your_cluster

# Required: Pusher (client-side)
NEXT_PUBLIC_PUSHER_KEY=your_key
NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster
```

3. Start the development server:

```bash
pnpm dev
```

---

## Required Environment Variables

These variables are **required** for the application to start. Missing any of these will cause the application to fail at import time with a descriptive error message.

### MongoDB

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/infrasight` |

#### Connection String Formats

**Local MongoDB:**
```env
MONGODB_URI=mongodb://localhost:27017/infrasight
```

**MongoDB with Authentication:**
```env
MONGODB_URI=mongodb://username:password@localhost:27017/infrasight?authSource=admin
```

**MongoDB Atlas (Cloud):**
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/infrasight?retryWrites=true&w=majority
```

#### Connection Options

The application uses these connection options (configured in `lib/db.ts`):

| Option | Value | Description |
|--------|-------|-------------|
| `bufferCommands` | `false` | Disable command buffering |
| `serverSelectionTimeoutMS` | `5000` | Timeout after 5 seconds |
| `socketTimeoutMS` | `45000` | Close sockets after 45s inactivity |

---

### Pusher (Real-time)

Pusher enables real-time WebSocket communication for live sensor updates.

#### Server-Side Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PUSHER_APP_ID` | Pusher application ID | Yes |
| `PUSHER_KEY` | Pusher key (for server-side) | Yes |
| `PUSHER_SECRET` | Pusher secret key | Yes |
| `PUSHER_CLUSTER` | Pusher cluster region | Yes |

#### Client-Side Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_PUSHER_KEY` | Pusher key for browser | Yes |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Pusher cluster for browser | Yes |

> **IMPORTANT**: Client-side variables **must** have the `NEXT_PUBLIC_` prefix. Without this prefix, the variables will not be exposed to the browser.

#### Example Configuration

```env
# Server-side Pusher credentials
PUSHER_APP_ID=1234567
PUSHER_KEY=a1b2c3d4e5f6g7h8i9j0
PUSHER_SECRET=k1l2m3n4o5p6q7r8s9t0
PUSHER_CLUSTER=us2

# Client-side Pusher credentials (must match server-side)
NEXT_PUBLIC_PUSHER_KEY=a1b2c3d4e5f6g7h8i9j0
NEXT_PUBLIC_PUSHER_CLUSTER=us2
```

---

## Optional Environment Variables

### Redis (Rate Limiting & Caching)

Redis is used for rate limiting and caching. Without Redis, rate limiting and caching are disabled (suitable for development).

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL | None (disabled) |
| `REDIS_TLS` | Enable TLS for Redis connection | `false` |

#### Connection Formats

**Local Redis:**
```env
REDIS_URL=redis://localhost:6379
```

**Upstash (Cloud Redis):**
```env
REDIS_URL=rediss://default:your-password@your-endpoint.upstash.io:6379
REDIS_TLS=true
```

> **Note**: The `rediss://` protocol automatically enables TLS.

---

### Rate Limiting

Rate limiting protects the API from abuse. Requires Redis to be configured.

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_ENABLED` | Enable/disable rate limiting | `true` |
| `RATE_LIMIT_INGEST_PER_DEVICE` | Max ingestion requests per device/minute | `1000` |
| `RATE_LIMIT_INGEST_PER_IP` | Max ingestion requests per IP/minute | `10000` |
| `RATE_LIMIT_MUTATIONS_PER_IP` | Max POST/PATCH/DELETE per IP/minute | `100` |

#### Example Configuration

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_INGEST_PER_DEVICE=1000
RATE_LIMIT_INGEST_PER_IP=10000
RATE_LIMIT_MUTATIONS_PER_IP=100
```

---

### Caching

Caching improves performance for frequently accessed endpoints. Requires Redis.

| Variable | Description | Default |
|----------|-------------|---------|
| `CACHE_ENABLED` | Enable/disable caching | `true` |
| `CACHE_METADATA_TTL` | Metadata cache TTL (seconds) | `600` (10 min) |
| `CACHE_HEALTH_TTL` | Health analytics cache TTL (seconds) | `30` |

#### Example Configuration

```env
CACHE_ENABLED=true
CACHE_METADATA_TTL=600
CACHE_HEALTH_TTL=30
```

---

### Monitoring & Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging verbosity | `info` |
| `ENABLE_METRICS` | Enable Prometheus metrics export | `false` |

#### Log Levels

| Level | Description |
|-------|-------------|
| `debug` | Verbose debug information |
| `info` | General operational information |
| `warn` | Warning messages |
| `error` | Error messages only |

#### Example Configuration

```env
LOG_LEVEL=info
ENABLE_METRICS=true
```

---

### Sentry Error Tracking

Sentry provides error tracking and monitoring.

| Variable | Description | Required |
|----------|-------------|----------|
| `SENTRY_DSN` | Server-side Sentry DSN | No |
| `NEXT_PUBLIC_SENTRY_DSN` | Client-side Sentry DSN | No |
| `SENTRY_ORG` | Sentry organization slug | No |
| `SENTRY_PROJECT` | Sentry project slug | No |
| `SENTRY_AUTH_TOKEN` | Auth token for source map uploads | No |

#### Example Configuration

```env
SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/1234567
NEXT_PUBLIC_SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/1234567
SENTRY_ORG=my-org
SENTRY_PROJECT=infrasight
SENTRY_AUTH_TOKEN=sntrys_eyJ...
```

---

### API Authentication

API key authentication is opt-in. Leave empty to disable (development mode).

| Variable | Description | Default |
|----------|-------------|---------|
| `API_KEYS` | Comma-separated API key definitions | None (disabled) |

#### Format

```
name:key:role,name:key:role,...
```

#### Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access to all endpoints |
| `operator` | Create, update, delete devices; ingest readings |
| `viewer` | Read-only access |

#### Example Configuration

```env
API_KEYS=sensor-gateway:abc123xyz:operator,dashboard:xyz789abc:viewer,admin-cli:admin123:admin
```

---

### Development Options

| Variable | Description | Default |
|----------|-------------|---------|
| `NUM_DEVICES` | Number of devices to seed | `500` |
| `READINGS_PER_DEVICE` | Readings per device when seeding | `25` |
| `REACT_EDITOR` | Editor for React error overlay | `code` |

#### Example Configuration

```env
NUM_DEVICES=500
READINGS_PER_DEVICE=25
REACT_EDITOR=code
```

---

## Environment-Specific Configuration

### Development (`.env.local`)

```env
# MongoDB - Local instance
MONGODB_URI=mongodb://localhost:27017/infrasight

# Pusher - Development credentials
PUSHER_APP_ID=dev_app_id
PUSHER_KEY=dev_key
PUSHER_SECRET=dev_secret
PUSHER_CLUSTER=us2
NEXT_PUBLIC_PUSHER_KEY=dev_key
NEXT_PUBLIC_PUSHER_CLUSTER=us2

# Redis - Optional for development
# REDIS_URL=redis://localhost:6379

# Disable rate limiting in development
RATE_LIMIT_ENABLED=false

# Verbose logging
LOG_LEVEL=debug

# Development seeding
NUM_DEVICES=100
READINGS_PER_DEVICE=10
```

### Staging (`.env.staging`)

```env
# MongoDB - Staging database
MONGODB_URI=mongodb+srv://staging_user:password@cluster.mongodb.net/infrasight-staging

# Pusher - Staging channel
PUSHER_APP_ID=staging_app_id
PUSHER_KEY=staging_key
PUSHER_SECRET=staging_secret
PUSHER_CLUSTER=us2
NEXT_PUBLIC_PUSHER_KEY=staging_key
NEXT_PUBLIC_PUSHER_CLUSTER=us2

# Redis - Staging instance
REDIS_URL=rediss://default:password@staging-redis.upstash.io:6379
REDIS_TLS=true

# Rate limiting enabled
RATE_LIMIT_ENABLED=true

# Standard logging
LOG_LEVEL=info

# Sentry - Staging project
SENTRY_DSN=https://staging@sentry.io/staging
NEXT_PUBLIC_SENTRY_DSN=https://staging@sentry.io/staging
```

### Production (`.env.production`)

```env
# MongoDB - Production database with replica set
MONGODB_URI=mongodb+srv://prod_user:password@cluster.mongodb.net/infrasight-prod?retryWrites=true&w=majority

# Pusher - Production channel
PUSHER_APP_ID=prod_app_id
PUSHER_KEY=prod_key
PUSHER_SECRET=prod_secret
PUSHER_CLUSTER=us2
NEXT_PUBLIC_PUSHER_KEY=prod_key
NEXT_PUBLIC_PUSHER_CLUSTER=us2

# Redis - Production instance
REDIS_URL=rediss://default:password@prod-redis.upstash.io:6379
REDIS_TLS=true

# Rate limiting with production limits
RATE_LIMIT_ENABLED=true
RATE_LIMIT_INGEST_PER_DEVICE=1000
RATE_LIMIT_INGEST_PER_IP=10000
RATE_LIMIT_MUTATIONS_PER_IP=100

# Caching enabled
CACHE_ENABLED=true
CACHE_METADATA_TTL=600
CACHE_HEALTH_TTL=30

# Production logging
LOG_LEVEL=warn
ENABLE_METRICS=true

# Sentry - Production project
SENTRY_DSN=https://production@sentry.io/production
NEXT_PUBLIC_SENTRY_DSN=https://production@sentry.io/production
SENTRY_ORG=my-org
SENTRY_PROJECT=infrasight
SENTRY_AUTH_TOKEN=sntrys_eyJ...

# API Authentication
API_KEYS=sensor-gateway-1:abc123:operator,sensor-gateway-2:def456:operator
```

---

## Service Setup Guides

### MongoDB Setup

#### Option 1: Local MongoDB

1. Install MongoDB Community Server:
   - macOS: `brew install mongodb-community`
   - Ubuntu: `sudo apt install mongodb`
   - Windows: Download from [mongodb.com](https://www.mongodb.com/try/download/community)

2. Start MongoDB:
   ```bash
   brew services start mongodb-community  # macOS
   sudo systemctl start mongod            # Linux
   ```

3. Create database and indexes:
   ```bash
   pnpm create-indexes-v2
   ```

#### Option 2: MongoDB Atlas (Cloud)

1. Create account at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)

2. Create a cluster:
   - Choose "Shared" for free tier
   - Select region closest to your deployment

3. Create database user:
   - Navigate to "Database Access"
   - Add new user with password authentication
   - Grant "readWriteAnyDatabase" role

4. Configure network access:
   - Navigate to "Network Access"
   - Add IP address (or 0.0.0.0/0 for any IP)

5. Get connection string:
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user password
   - Replace `<dbname>` with `infrasight`

---

### Pusher Setup

1. Create account at [pusher.com](https://pusher.com)

2. Create a new Channels app:
   - Click "Create new app"
   - Name: `infrasight`
   - Cluster: Choose nearest region
   - Front-end: React
   - Back-end: Node.js

3. Get credentials:
   - Navigate to "App Keys"
   - Copy: `app_id`, `key`, `secret`, `cluster`

4. Configure environment:
   ```env
   PUSHER_APP_ID=your_app_id
   PUSHER_KEY=your_key
   PUSHER_SECRET=your_secret
   PUSHER_CLUSTER=your_cluster
   NEXT_PUBLIC_PUSHER_KEY=your_key
   NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster
   ```

5. (Optional) Configure Pusher Beams for push notifications:
   - Navigate to "Beams" tab
   - Create a Beams instance
   - Copy `instance_id` and `primary_key`

---

### Redis Setup

#### Option 1: Upstash (Recommended for Cloud)

1. Create account at [upstash.com](https://upstash.com)

2. Create new Redis database:
   - Click "Create Database"
   - Choose region nearest to your deployment
   - Enable TLS

3. Get connection URL:
   - Click on your database
   - Copy the "Redis URL"

4. Configure environment:
   ```env
   REDIS_URL=rediss://default:password@your-endpoint.upstash.io:6379
   REDIS_TLS=true
   ```

#### Option 2: Local Redis

1. Install Redis:
   ```bash
   brew install redis           # macOS
   sudo apt install redis       # Ubuntu
   ```

2. Start Redis:
   ```bash
   brew services start redis    # macOS
   sudo systemctl start redis   # Linux
   ```

3. Configure environment:
   ```env
   REDIS_URL=redis://localhost:6379
   ```

---

### Sentry Setup

1. Create account at [sentry.io](https://sentry.io)

2. Create a new project:
   - Select "Next.js" as platform
   - Name: `infrasight`

3. Get DSN:
   - Navigate to Settings > Projects > infrasight > Client Keys (DSN)
   - Copy the DSN

4. (Optional) Configure source maps:
   - Generate auth token at Settings > Account > API > Auth Tokens
   - Grant "project:releases" and "org:read" permissions

5. Configure environment:
   ```env
   SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/1234567
   NEXT_PUBLIC_SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/1234567
   SENTRY_ORG=my-org
   SENTRY_PROJECT=infrasight
   SENTRY_AUTH_TOKEN=sntrys_eyJ...
   ```

---

## Validation & Troubleshooting

### Startup Validation

The application validates environment variables at import time. Missing required variables cause immediate failure with descriptive error messages:

```
Error: Please define the MONGODB_URI environment variable inside .env.local
```

### Common Issues

#### MongoDB Connection Failed

**Error**: `Failed to connect to MongoDB`

**Causes**:
- MongoDB server not running
- Incorrect connection string
- Network/firewall blocking connection
- Authentication failed

**Solutions**:
1. Verify MongoDB is running: `mongosh --eval "db.serverStatus()"`
2. Check connection string format
3. Verify network access (for Atlas, check IP whitelist)
4. Verify username/password

#### Pusher Connection Failed

**Error**: `Pusher: Connection failed` in browser console

**Causes**:
- Missing `NEXT_PUBLIC_` prefix on client-side variables
- Incorrect cluster
- Invalid credentials

**Solutions**:
1. Verify `NEXT_PUBLIC_PUSHER_KEY` and `NEXT_PUBLIC_PUSHER_CLUSTER` are set
2. Verify values match server-side credentials
3. Check Pusher dashboard for connection attempts

#### Redis Connection Failed

**Error**: `Redis connection error` in logs

**Causes**:
- Redis server not running
- Incorrect URL format
- TLS misconfiguration

**Solutions**:
1. Verify Redis is running: `redis-cli ping`
2. Check URL format (`redis://` vs `rediss://`)
3. For Upstash, ensure `REDIS_TLS=true`

### Testing Environment Variables

Create a test script to validate your environment:

```bash
# Validate MongoDB
pnpm test

# Check if all variables are set
node -e "
const required = [
  'MONGODB_URI',
  'PUSHER_APP_ID',
  'PUSHER_KEY',
  'PUSHER_SECRET',
  'PUSHER_CLUSTER',
  'NEXT_PUBLIC_PUSHER_KEY',
  'NEXT_PUBLIC_PUSHER_CLUSTER'
];

const missing = required.filter(v => !process.env[v]);
if (missing.length) {
  console.error('Missing variables:', missing);
  process.exit(1);
}
console.log('All required variables are set');
"
```

---

## Security Best Practices

### General Rules

1. **Never commit `.env.local`**: Add to `.gitignore`
2. **Use secrets managers** in production (AWS Secrets Manager, Vercel env vars, etc.)
3. **Rotate credentials** regularly
4. **Use different credentials** for each environment
5. **Restrict API key permissions** to minimum required

### Secret Values

Keep these values secret:
- `MONGODB_URI` (contains password)
- `PUSHER_SECRET`
- `PUSHER_PRIMARY_KEY`
- `REDIS_URL` (contains password)
- `SENTRY_AUTH_TOKEN`
- `API_KEYS`

### Client-Side Exposure

Only these variables are exposed to the browser:
- `NEXT_PUBLIC_PUSHER_KEY`
- `NEXT_PUBLIC_PUSHER_CLUSTER`
- `NEXT_PUBLIC_SENTRY_DSN`

All other variables remain server-side only.

### Vercel Deployment

When deploying to Vercel:

1. Add environment variables in Project Settings > Environment Variables
2. Mark sensitive values as "Sensitive" (encrypted)
3. Use different values for Preview, Development, and Production

### Docker Deployment

Use Docker secrets or environment file:

```bash
# Using environment file
docker run --env-file .env.production -p 3000:3000 infrasight

# Using Docker secrets
docker secret create mongodb_uri ./secrets/mongodb_uri.txt
docker service create --secret mongodb_uri infrasight
```

---

## Complete Example Configuration

```env
# =============================================================================
# Infrasight Environment Configuration
# =============================================================================

# -----------------------------------------------------------------------------
# Required: MongoDB
# -----------------------------------------------------------------------------
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/infrasight

# -----------------------------------------------------------------------------
# Required: Pusher Real-time
# -----------------------------------------------------------------------------
# Server-side
PUSHER_APP_ID=1234567
PUSHER_KEY=a1b2c3d4e5f6g7h8i9j0
PUSHER_SECRET=k1l2m3n4o5p6q7r8s9t0
PUSHER_CLUSTER=us2

# Client-side (must match server-side)
NEXT_PUBLIC_PUSHER_KEY=a1b2c3d4e5f6g7h8i9j0
NEXT_PUBLIC_PUSHER_CLUSTER=us2

# Optional: Pusher Beams (push notifications)
PUSHER_INSTANCE_ID=
PUSHER_PRIMARY_KEY=

# -----------------------------------------------------------------------------
# Optional: Redis (Rate Limiting & Caching)
# -----------------------------------------------------------------------------
REDIS_URL=rediss://default:password@endpoint.upstash.io:6379
REDIS_TLS=true

# -----------------------------------------------------------------------------
# Optional: Rate Limiting
# -----------------------------------------------------------------------------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_INGEST_PER_DEVICE=1000
RATE_LIMIT_INGEST_PER_IP=10000
RATE_LIMIT_MUTATIONS_PER_IP=100

# -----------------------------------------------------------------------------
# Optional: Caching
# -----------------------------------------------------------------------------
CACHE_ENABLED=true
CACHE_METADATA_TTL=600
CACHE_HEALTH_TTL=30

# -----------------------------------------------------------------------------
# Optional: Monitoring & Logging
# -----------------------------------------------------------------------------
LOG_LEVEL=info
ENABLE_METRICS=false

# -----------------------------------------------------------------------------
# Optional: Sentry Error Tracking
# -----------------------------------------------------------------------------
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=

# -----------------------------------------------------------------------------
# Optional: API Authentication
# -----------------------------------------------------------------------------
API_KEYS=

# -----------------------------------------------------------------------------
# Development Options
# -----------------------------------------------------------------------------
NUM_DEVICES=500
READINGS_PER_DEVICE=25
REACT_EDITOR=code
```

---

*Last Updated: 2026-01-05*
