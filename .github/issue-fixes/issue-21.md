## Task

Create analytics energy endpoint for time-series data aggregation with granularity and grouping support.

## Endpoint

### GET `/api/v2/analytics/energy`

Query Parameters:
- `device_ids` (optional, comma-separated filter)
- `start_date` (required, ISO 8601)
- `end_date` (required, ISO 8601)
- `granularity` (required, enum: 'minute', 'hour', 'day')
- `aggregation_type` (required, enum: 'sum', 'avg', 'min', 'max', 'percentile')
- `percentile` (optional, for percentile aggregation: 50, 75, 90, 95, 99)
- `group_by` (optional, enum: 'device', 'floor', 'room', 'department', 'type')
- `reading_type` (optional, filter by reading type: 'temperature', 'humidity', etc.)
- `exclude_invalid` (optional, default true - exclude is_valid=false)

Response:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "timestamp": "2025-12-10T12:00:00Z",
        "value": 23.5,
        "device_id": "507f...",
        "unit": "celsius"
      }
    ],
    "metadata": {
      "granularity": "hour",
      "aggregation_type": "avg",
      "total_points": 168,
      "excluded_invalid": 5
    }
  }
}
```

## Requirements

- Optimize aggregation pipeline with proper $match, $group stages
- Use compound indexes for device_id + timestamp queries
- Support grouping by device attributes via $lookup to devices_v2
- Quality filtering: Exclude readings where is_valid=false if requested
- Handle large date ranges efficiently
- Cache expensive aggregations in Redis (5-minute TTL)
- Calculate appropriate bucket boundaries based on granularity

## Implementation Details

- Use MongoDB $group with $dateToString for bucketing
- Apply aggregation type: $sum, $avg, $min, $max, or percentile ($percentile or custom logic)
- For group_by: Join with devices_v2 to get location/department
- Time zone handling: Assume UTC, document clearly
- Empty buckets: Return all buckets in time range (filled and empty)

## Acceptance Criteria

- [ ] Aggregation pipeline works correctly
- [ ] All granularities supported (minute, hour, day)
- [ ] All aggregation types work
- [ ] Grouping by device attributes works
- [ ] Quality filtering excludes invalid readings
- [ ] Caching improves performance
- [ ] Response includes metadata
- [ ] Handles large date ranges efficiently
