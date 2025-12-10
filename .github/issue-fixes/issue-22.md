## Task

Create remaining v2 API endpoints for complete CRUD and analytics coverage.

## Endpoints to Implement

### Device Operations

- [ ] 3.2: GET/PATCH/DELETE `/api/v2/devices/[id]` - Single device with soft delete
- [ ] 3.3: GET `/api/v2/devices/[id]/history` - Audit history for device

### Reading Operations

- [ ] 3.4: GET `/api/v2/readings` - Query readings with filters, quality, pagination
- [ ] 3.6: GET `/api/v2/readings/latest` - Latest readings for devices with quality metrics

### Analytics

- [ ] 3.8: GET `/api/v2/analytics/health` - Device health dashboard
- [ ] 3.9: GET `/api/v2/analytics/anomalies` - Anomaly detection and trends

### Metadata & Audit

- [ ] 3.10: GET `/api/v2/metadata` - Aggregated metadata (manufacturers, departments, stats)
- [ ] 3.11: GET `/api/v2/audit` - Audit trail queries across all devices

### Optional

- [ ] 3.12: Update `/api/cron/simulate` for dual-write testing

## Key Requirements (All Endpoints)

- Full Zod validation on input
- Consistent error handling with error codes
- Rate limiting applied
- Structured responses with success/error format
- Query optimization (indexes, lean(), projection)
- Soft delete support (where applicable)
- Comprehensive logging

## Acceptance Criteria

- [ ] All 11 endpoints implemented
- [ ] All validation in place
- [ ] All endpoints tested
- [ ] Rate limiting working
- [ ] No N+1 queries
- [ ] Response times acceptable
