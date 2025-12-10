## Task

Create readings ingest endpoint for bulk insertion with deduplication and quality scoring.

## Endpoint

### POST `/api/v2/readings/ingest`

Request:
```json
{
  "readings": [
    {
      "metadata": {
        "device_id": "507f...",
        "type": "temperature",
        "unit": "celsius",
        "source": "sensor"
      },
      "timestamp": "2025-12-10T12:00:00Z",
      "value": 23.5,
      "context": {
        "battery_level": 85,
        "signal_strength": 90
      }
    }
  ],
  "idempotency_key": "uuid-string" (optional)
}
```

Response:
```json
{
  "success": true,
  "data": {
    "inserted": 100,
    "rejected": 2,
    "errors": [
      { "index": 5, "error": "Invalid value for temperature" }
    ]
  }
}
```

## Requirements

- Batch validation using Zod array schemas
- Quality scoring: Set confidence_score based on context/validity
- Deduplication: Skip duplicate readings (same device_id, timestamp, value)
- Idempotency: Idempotency key prevents double-insert
- **CRITICAL Rate Limiting**: 1000 req/min per device_id, 10000 req/min per IP
- Insert processing metadata: raw_value, calibration_offset, ingested_at
- Error tracking: Collect and return errors without failing entire batch

## Implementation Details

- Batch size limit: 1000 readings per request
- Request size limit: 10MB max
- Process readings in 100-document batches
- Validate all required fields present
- Set is_valid=true for readings passing validation
- Calculate anomaly_score (placeholder: 0.0 initially)

## Acceptance Criteria

- [ ] Bulk insert works correctly
- [ ] Deduplication prevents duplicates
- [ ] Idempotency key prevents retries from duplicating
- [ ] Quality scoring applied
- [ ] Rate limiting enforced (device + IP)
- [ ] Error handling is robust
- [ ] Performance acceptable for 1000 readings/request
