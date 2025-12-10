## Task

Implement Redis-based rate limiting by IP address and device ID (CRITICAL for preventing runaway sensors).

## Implementation

### `/lib/ratelimit/limiter.ts`

- Function: `createRateLimiter(options)` - Factory function
- Algorithm: Sliding window using Redis
- Support two types of limits:
  - IP-based (for DDoS protection)
  - Device-based (for malfunctioning sensor protection)
- Return: `{ allowed: boolean, remaining: number, reset_at: ISO8601 }`

### Rate Limit Configuration

**Critical: Device ID Limiting**
- `/api/v2/readings/ingest`: 1000 req/min per device_id
- This prevents a single malfunctioning sensor from overwhelming the DB

**IP-based Limiting**
- `/api/v2/readings/ingest`: 10000 req/min per IP
- Other mutations: 100 req/min per IP
- Query endpoints: 1000 req/min per IP

### Integration

- Add middleware to all v2 routes
- Check both IP and device_id limits
- Return 429 with Retry-After header
- Log rate limit violations

## Requirements

- Redis connection for distributed rate limiting
- Sliding window algorithm (more accurate than fixed window)
- Clear remaining quota in responses
- Reset time in ISO8601 format
- Atomic operations (use Redis Lua scripts if needed)
- Configurable limits per endpoint

## Acceptance Criteria

- [ ] Rate limiting works by IP address
- [ ] Rate limiting works by device ID
- [ ] 429 responses returned when exceeded
- [ ] Retry-After header included
- [ ] Remaining quota tracked
- [ ] Redis connection efficient
- [ ] Zero false positives/negatives
