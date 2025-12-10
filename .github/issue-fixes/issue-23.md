## Task

Create type-safe API client for v2 endpoints and update dashboard main page.

## Components

### `/lib/api/v2-client.ts`

- Export typed functions for all v2 endpoints
- Example: `getDevices(params): Promise`
- Include error handling and retry logic
- Add request caching for metadata endpoints
- Type safety from `/types/v2/`
- Handle rate limit 429 responses with backoff

### Update `app/page.tsx`

- Switch from `/api/devices` to `/api/v2/devices`
- Switch from `/api/readings/latest` to `/api/v2/readings/latest`
- Add error boundary for graceful error handling
- Add loading states with skeletons
- Add error states with retry options
- Add health status indicator in header (% devices online from `/api/v2/analytics/health`)
- Add recent alerts/anomalies section (from `/api/v2/analytics/anomalies`)
- Add system health widget component (new)

## Requirements

- Type-safe API calls using v2 types
- Error handling with user-friendly messages
- Loading states for better UX
- Retry logic for failed requests
- Cache metadata endpoints (10-minute TTL)

## Acceptance Criteria

- [ ] v2-client works for all endpoints
- [ ] Main dashboard uses v2 endpoints
- [ ] Error handling prevents crashes
- [ ] Loading states improve UX
- [ ] Health status visible in header
- [ ] No console errors or warnings
