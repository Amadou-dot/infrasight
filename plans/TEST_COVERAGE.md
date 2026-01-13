# Phase 7: Comprehensive Test Coverage

**Status:** Planned
**Priority:** High
**Dependencies:** Phase 6 Complete

---

## Overview

Phase 6 established the testing infrastructure and implemented foundational tests. Phase 7 will expand test coverage from the current **47.75%** to the target **≥80%** for critical paths.

## Current Status (Phase 6 Completion)

### ✅ Completed

- Testing infrastructure (Jest + Playwright + MongoDB Memory Server)
- **108 tests passing** (81 unit + 27 integration)
- Test documentation in `docs/testing-v2.md`
- ESLint configuration for type safety
- Zero TypeScript errors in strict mode

### ⚠️ Current Coverage

```
Statements   : 47.75% (target: 80%)
Branches     : 19.59% (target: 70%)
Functions    : 25.7%  (target: 75%)
Lines        : 48.35% (target: 80%)
```

**Gap:** Need ~500+ additional test cases to reach target coverage

---

## Phase 7 Deliverables

### 7.1: Model Tests

- [ ] `models/v2/ReadingV2.test.ts` - Timeseries query tests
- [ ] Expand `models/v2/DeviceV2.test.ts` - Additional edge cases

### 7.2: Utility Tests

- [ ] `lib/errors/errorHandler.test.ts` - Error handling utilities
- [ ] `lib/api/v2-client.test.ts` - API client methods
- [ ] `lib/utils/*.test.ts` - Utility functions

### 7.3: Integration Tests

- [ ] `app/api/v2/readings/route.integration.test.ts` - Reading API
- [ ] `app/api/v2/analytics/health/route.integration.test.ts` - Health analytics
- [ ] `app/api/v2/analytics/anomalies/route.integration.test.ts` - Anomaly detection
- [ ] `app/api/v2/analytics/energy/route.integration.test.ts` - Energy analytics
- [ ] `app/api/v2/analytics/maintenance-forecast/route.integration.test.ts` - Maintenance
- [ ] `app/api/v2/analytics/temperature-correlation/route.integration.test.ts` - Temperature
- [ ] `app/api/v2/devices/[id]/history/route.integration.test.ts` - Audit logs

### 7.4: E2E Tests

- [ ] `e2e/dashboard.spec.ts` - Dashboard loading and navigation
- [ ] `e2e/device-detail.spec.ts` - Device detail modal flow
- [ ] `e2e/real-time-updates.spec.ts` - Pusher real-time updates
- [ ] `e2e/error-handling.spec.ts` - Error state handling

### 7.5: Component Tests (Optional)

- [ ] Component render tests with Testing Library
- [ ] User interaction tests
- [ ] Real-time update simulations

---

## Success Criteria

### Coverage Targets

| Test Type          | Coverage Goal  | Priority |
| ------------------ | -------------- | -------- |
| API Routes         | ≥85%           | Critical |
| Models             | ≥90%           | Critical |
| Validation Schemas | 100%           | Critical |
| Utilities          | ≥80%           | High     |
| Components         | ≥70%           | Medium   |
| E2E (User Flows)   | Critical paths | High     |

### Quality Metrics

- ✅ All tests passing (0 failures)
- ✅ No flaky tests (consistent results)
- ✅ Fast test execution (<2 minutes for full suite)
- ✅ Clear test documentation
- ✅ CI/CD integration

---

## Implementation Strategy

### Priority 1: Critical Path Tests (Week 1)

1. **API Integration Tests** - Highest ROI
   - Device CRUD operations
   - Reading ingestion and queries
   - Health analytics endpoint

2. **Model Tests** - Core business logic
   - ReadingV2 timeseries queries
   - DeviceV2 custom ID handling
   - Audit trail generation

### Priority 2: Analytics & Error Handling (Week 2)

1. **Analytics Endpoints**
   - Anomaly detection
   - Energy analytics
   - Maintenance forecasting
   - Temperature correlation

2. **Error Handling**
   - Error handler utilities
   - API client retry logic
   - Validation error formatting

### Priority 3: E2E & Components (Week 3)

1. **E2E Critical Flows**
   - Dashboard load → device list → device detail
   - Real-time reading updates
   - Error state recovery

2. **Component Tests** (if time permits)
   - Key interactive components
   - Error boundary behavior

---

## Coverage Improvement Plan

### Incremental Targets

| Milestone | Coverage Target | Deliverables                       |
| --------- | --------------- | ---------------------------------- |
| Phase 7.1 | 60%             | Model tests + readings integration |
| Phase 7.2 | 70%             | All analytics endpoints            |
| Phase 7.3 | 80%             | E2E critical paths                 |
| Phase 7.4 | 85%+            | Component tests (stretch)          |

### CI/CD Integration

- Add coverage reports to PRs
- Block merges if coverage drops below threshold
- Generate coverage badges for README
- Automated coverage trending

---

## Decision: Phase 6 vs Phase 7

### Why Split Into Two Phases?

**Phase 6 Achievements:**

- ✅ Testing infrastructure fully configured
- ✅ Documentation complete (5,512 lines)
- ✅ Type safety enforced (zero `any` types)
- ✅ Foundation tests prove the infrastructure works

**Phase 7 Focus:**

- Expand from foundational tests to comprehensive coverage
- Allows Phase 6 to be merged for documentation and infrastructure benefits
- Prevents blocking other work while achieving full coverage
- Provides clear tracking of coverage improvements

### Benefits of This Approach

1. **Unblock Documentation** - Teams can reference docs immediately
2. **Incremental Progress** - Track coverage improvements systematically
3. **Prioritization** - Focus on critical paths first
4. **Quality Gates** - Can set realistic thresholds that improve over time

---

## Acceptance Criteria for Phase 7

- [ ] Overall coverage ≥80%
- [ ] API routes coverage ≥85%
- [ ] Model coverage ≥90%
- [ ] Zero test failures
- [ ] E2E tests cover critical user flows
- [ ] CI/CD pipeline enforces coverage thresholds
- [ ] Coverage reports automated in PRs

---

## Timeline

**Estimated Duration:** 3-4 weeks (depending on team capacity)

**Milestones:**

- Week 1: API integration tests + model tests (reach 60%)
- Week 2: Analytics endpoint tests (reach 70%)
- Week 3: E2E tests (reach 80%+)
- Week 4: Component tests + buffer (85%+)

---

## Resources

- [Testing Guide](../docs/testing-v2.md) - Strategy and implementation examples
- [Phase 6 Plan](./PHASE6_IMPLEMENTATION_PLAN.md) - Infrastructure setup
- [Jest Documentation](https://jestjs.io/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library](https://testing-library.com/)

---

**Created:** 2026-01-05
**Status:** Planned - Ready to begin after Phase 6 merge
**Tracking Issue:** TBD (create after Phase 6 merge)
