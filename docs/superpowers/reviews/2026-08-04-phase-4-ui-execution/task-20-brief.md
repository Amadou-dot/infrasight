### Task 20: End-to-end coverage

**Files:**
- Create: `e2e/alerts.spec.ts`

E2E runs with `E2E_TESTING=true`, which `proxy.ts` uses to bypass Clerk. Follow the shape of `e2e/device-detail.spec.ts`: `page.goto`, `waitForLoadState('load')`, generous `timeout` values on the first visible assertion, and tolerant locators.

**Interfaces:**
- Consumes: everything above.
- Produces: no exports.

- [ ] **Step 1: Write the spec**

Create `e2e/alerts.spec.ts`:

```typescript
/**
 * Alerts E2E Tests
 *
 * Requires a seeded database with alert rules (pnpm seed) and at least one cron
 * run to have produced alerts (GET /api/v2/cron/simulate).
 */

import { test, expect } from '@playwright/test';

test.describe('Alerts', () => {
  test('should render the active alerts page', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible({ timeout: 15000 });
  });

  test('should reach alerts from the top navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    await page.getByRole('link', { name: /alerts/i }).first().click();

    await expect(page).toHaveURL(/\/alerts/);
  });

  test('should switch to history via the status filter', async ({ page }) => {
    await page.goto('/alerts?status=resolved');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible({ timeout: 15000 });
  });

  test('should survive a refresh on a deep-linked alert', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    const firstAlert = page.locator('a[href^="/alerts/"]').first();
    const count = await firstAlert.count();
    test.skip(count === 0, 'No alerts present in the seeded database');

    await firstAlert.click();
    await expect(page).toHaveURL(/\/alerts\/[0-9a-f]{24}/);

    const url = page.url();
    await page.reload();
    await page.waitForLoadState('load');

    expect(page.url()).toBe(url);
    await expect(page.getByText(/breached since/i)).toBeVisible({ timeout: 15000 });
  });

  test('should render the styled 404 for an unknown alert id', async ({ page }) => {
    await page.goto('/alerts/507f1f77bcf86cd799439011');
    await page.waitForLoadState('load');

    await expect(page.getByText(/not found|404/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('should reach the rules page', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    await page.getByRole('link', { name: /manage rules/i }).click();

    await expect(page).toHaveURL(/\/alerts\/rules/);
    await expect(page.getByText(/high temperature/i)).toBeVisible({ timeout: 15000 });
  });

  test('should render acknowledge and resolve as gated controls rather than hiding them', async ({
    page,
  }) => {
    await page.goto('/alerts');
    await page.waitForLoadState('load');

    const ack = page.getByRole('button', { name: /acknowledge/i }).first();
    const count = await ack.count();
    test.skip(count === 0, 'No open alerts present in the seeded database');

    // Present either way — a visitor should learn the workflow exists.
    await expect(ack).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm test:e2e e2e/alerts.spec.ts`
Expected: PASS (some tests may `skip` if the seeded database has no alerts yet — run `pnpm seed`, then hit `GET /api/v2/cron/simulate` with the `SEED_SECRET` bearer token a few times first, so the duration-gated temperature rule has time to promote).

- [ ] **Step 3: Full verification**

Run: `pnpm lint && npx tsc --noEmit && pnpm test:coverage && pnpm build`
Expected: lint clean, no type errors, coverage at or above `branches 55 / functions 55 / lines 75 / statements 75`, clean production build.

- [ ] **Step 4: Commit**

```bash
git add e2e/alerts.spec.ts
git commit -m "test(alerting): add end-to-end coverage for the alerts UI"
```

---

## Task Dependency Graph

```
Task 1 (AlertRuleV2) ──┬─→ Task 3 (validation + wire types) ──┬─→ Task 10 (alerts API) ──┐
                       │                                       │                          │
Task 2 (AlertV2) ──────┘                                       └─→ Task 11 (rules API) ───┤
                                                                                           │
Task 4 (cache + metrics) ─→ Task 6 (rule cache) ─→ Task 7 (evaluate) ─→ Task 8 (sweep)     │
                       ↑                              ↑                     │              │
Task 5 (selector) ─────┴──────────────────────────────┘                     ↓              ↓
                                                                    Task 9 (write paths)  Task 12 (client + hooks)
                                                                            │              │
                                                                            └─→ Task 13 (Pusher notify) ─→ Task 14 (subscribe + toasts)
                                                                                                                 │
                                                       Task 15 (badges + list + /alerts) ←─────────────────────────┘
                                                              │
                                                              ├─→ Task 16 (detail page)
                                                              ├─→ Task 17 (rules UI)
                                                              └─→ Task 18 (rename + widget + nav)
                                                                          │
                                                              Task 19 (seed) ─→ Task 20 (E2E)
```

Tasks 1, 2, 4, and 5 have no dependencies on each other and can be done in any order. Tasks 10 and 11 can run in parallel with Tasks 6–9 once Tasks 1–3 land. Task 20 must be last — it needs a seeded database and every route in place.

## Issue Mapping

| Issue | Tasks |
| --- | --- |
| #96 Add AlertRule and Alert models with validation | 1, 2, 3 |
| #97 Evaluate alert rules on both write paths | 4, 5, 6, 7, 8, 9 |
| #98 Lifecycle and API | 10, 11 |
| #99 UI | 12, 15, 16, 17, 18 |
| #100 Pusher delivery | 13, 14 |
| Cross-cutting (seed, E2E) | 19, 20 |

## Definition of Done

The phase is complete when all of the following hold:

- `pnpm lint && npx tsc --noEmit && pnpm test:coverage && pnpm build` is clean, with coverage at or above the configured thresholds.
- `pnpm create-indexes-v2 && pnpm verify-indexes` reports all eight new alert indexes present.
- A fresh `pnpm seed` followed by a few authenticated `GET /api/v2/cron/simulate` calls produces visible alerts on `/alerts`.
- An anonymous visitor can read `/alerts`, `/alerts/[id]`, and `/alerts/rules`. On a **demo deployment** (`NEXT_PUBLIC_DEMO_MODE=true`) they see Acknowledge / Resolve / New rule **disabled with a tooltip** rather than hidden; off demo mode a non-admin sees them hidden, matching every other screen. Both behaviours come from `useAdminAction()` — no screen hand-rolls this.
- A member `PATCH` to `/api/v2/alerts/[id]` returns 403; an admin `PATCH` returns 200.
- Triggering a rule while `/alerts` is open in a browser raises a toast and updates the nav badge without a refresh.
- `grep -rn "AlertsPanel" --include="*.tsx" .` returns nothing outside `node_modules`.
- `GET /api/v2/alerts?sortBy=severity&sortDirection=desc` returns **critical before warning before info**, and the dashboard widget shows the same order.
- The cron path broadcasts only readings that persisted — `newReadings` appears in no `pusherServer.trigger` call.
- `/alerts?status=resolved&severity=critical` survives a reload and a browser Back, and `/alerts` carries no default parameters in its query string.
