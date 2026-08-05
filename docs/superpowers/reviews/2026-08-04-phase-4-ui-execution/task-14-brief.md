### Task 14: Client subscription and toasts

The existing `InfraSight` channel gains one event rather than a second channel being created. `PusherProvider` already owns exactly one subscription and multiplexes callbacks to subscribers, so adding an event keeps subscription teardown in the one place that already handles it correctly — which satisfies #100's "subscriptions clean up on unmount" by construction.

**Files:**
- Modify: `types/v2/alert.types.ts` (add `of` to the `storm` variant, Step 0)
- Modify: `lib/alerting/notify.ts` (set `of`, Step 0)
- Modify: `lib/alerting/index.ts` (give the nested broadcast catches observability, Step 0)
- Modify: `__tests__/unit/lib/alerting/notify.test.ts` (assert `of` on both storm paths, Step 0)
- Modify: `lib/pusher-context.tsx`
- Create: `components/alerts/AlertToaster.tsx`
- Test: `__tests__/unit/lib/pusher-alerts.test.tsx`
- Test: `__tests__/unit/components/AlertToaster.test.tsx`

**Only `fired` raises a toast.** `resolved` is broadcast so open lists reconcile without a refetch, but raises no popup — nobody wants one per device when a floor-wide condition clears. This structurally satisfies #100's "notifications do not fire for a viewer's own acknowledge and resolve actions": firing is always system-generated, so no viewer can ever cause a toast. The acting admin gets feedback from their own mutation's optimistic update instead.

- [ ] **Step 0: Make the `storm` envelope say which direction it is**

`AlertEvent`'s `storm` variant (`types/v2/alert.types.ts`) is `{ kind: 'storm', count, by_severity, since }` — with **nothing distinguishing a storm of alerts firing from a storm of alerts clearing**. `publishAlertEvents` bounds `fired` and `resolved` independently, and a floor-wide condition clearing is exactly the case that overflows the resolved list, so resolved storms are not hypothetical. The consumer cannot tell them apart, and the toast copy below (`${event.count} alerts firing`) would announce a mass *recovery* as a mass *outage* — the most alarming message in the app, fired on the best possible news.

Found during Task 13's review; the type predates that task and its code matched the type exactly, so it lands here, on the first consumer that has to branch on it.

Add the discriminator to the wire type:

```typescript
  | {
      kind: 'storm';
      /** Which direction this storm is: alerts opening, or alerts clearing. */
      of: 'fired' | 'resolved';
      count: number;
      by_severity: Record<AlertSeverity, number>;
      since: string;
    };
```

Then set it in `lib/alerting/notify.ts` — `stormEnvelope()` takes the direction from its caller, so `buildFiredEnvelope` passes `'fired'` and `buildResolvedEnvelope` passes `'resolved'`. Extend that file's existing storm tests to assert `of` on both paths; a storm test that does not check `of` cannot tell the two apart either.

`types/v2/alert.types.ts` must keep its zero imports — it is loaded by client components.

**While you are in `lib/alerting/`, give the two nested broadcast catches a voice.** Task 13's fix round added `catch { }` blocks around `publishAlertEvents` in both `safe*` wrappers (`lib/alerting/index.ts`, in `safeEvaluateReadings` and `safeSweepStaleAlerts`) so a broadcast fault cannot discard a committed result. Correct — but they are comment-only, so they swallow with **zero** observability. `trigger()` in `notify.ts` wraps only the `pusherServer.trigger()` call, so a throw from the synchronous envelope math (`buildFiredEnvelope` / `buildResolvedEnvelope`, which run before `trigger()` is reached) now produces no log line, no Sentry event, and no metric. Before that fix it at least reached the outer catch and was logged — mislabelled, which was the bug, but visible.

An empty catch in the alerting subsystem is the same shape as the Critical the backend review already fixed once ("the alerting failure signal is unreachable in production"). Do not leave a second one. Log and report, but still do not rethrow:

```typescript
  } catch (error) {
    // Never let a broadcast fault discard an evaluation the DB already
    // committed — but never let it vanish silently either.
    logger.error('Alert broadcast failed after a committed write', {
      error: error instanceof Error ? error.message : String(error),
    });
    reportToSentry(error);
  }
```

`reportToSentry` is already defined in that file and is itself guarded against throwing. Add a test asserting the failure is reported — the existing isolation tests only assert that the result survives, which passes just as well against an empty catch.



**Interfaces:**
- Consumes: `AlertEvent` from `@/types/v2/alert.types` (Task 3); `queryKeys` (Task 12).
- Produces:
  - `subscribeAlerts(cb: AlertsCallback)` / `unsubscribeAlerts(cb)` on `PusherContextValue`
  - `export function usePusherAlerts(callback: (event: AlertEvent) => void): void`
  - `export function AlertToaster(): null` — mount-once component that raises toasts and reconciles the React Query cache

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/lib/pusher-alerts.test.tsx` (jsdom project — note the `.tsx` extension):

```typescript
/**
 * usePusherAlerts Tests
 */

import { render, act } from '@testing-library/react';
import React from 'react';
import { PusherProvider, usePusherAlerts } from '@/lib/pusher-context';
import { getPusherClient } from '@/lib/pusher-client';
import type { AlertEvent } from '@/types/v2/alert.types';

const handlers = new Map<string, (data: unknown) => void>();
const unbind = jest.fn();
const unsubscribe = jest.fn();

jest.mock('@/lib/pusher-client', () => ({
  getPusherClient: jest.fn(() => ({
    subscribe: jest.fn(() => ({
      bind: (event: string, handler: (data: unknown) => void) => {
        handlers.set(event, handler);
      },
      unbind: (event: string) => {
        unbind(event);
        handlers.delete(event);
      },
    })),
    unsubscribe,
  })),
}));

function Consumer({ onEvent }: { onEvent: (e: AlertEvent) => void }) {
  usePusherAlerts(onEvent);
  return null;
}

beforeEach(() => {
  handlers.clear();
  unbind.mockClear();
  unsubscribe.mockClear();
  (getPusherClient as jest.Mock).mockClear();
});

describe('usePusherAlerts', () => {
  it('should bind the alert-event name', () => {
    render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    expect(handlers.has('alert-event')).toBe(true);
  });

  it('should deliver a fired envelope to subscribers', () => {
    const onEvent = jest.fn();
    render(
      <PusherProvider>
        <Consumer onEvent={onEvent} />
      </PusherProvider>
    );

    const envelope: AlertEvent = { kind: 'fired', alerts: [] };
    act(() => handlers.get('alert-event')!(envelope));

    expect(onEvent).toHaveBeenCalledWith(envelope);
  });

  it('should deliver a storm envelope', () => {
    const onEvent = jest.fn();
    render(
      <PusherProvider>
        <Consumer onEvent={onEvent} />
      </PusherProvider>
    );

    const envelope: AlertEvent = {
      kind: 'storm',
      count: 312,
      by_severity: { info: 0, warning: 12, critical: 300 },
      since: '2026-08-01T12:00:00.000Z',
    };
    act(() => handlers.get('alert-event')!(envelope));

    expect(onEvent).toHaveBeenCalledWith(envelope);
  });

  it('should not break the readings subscription', () => {
    render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    expect(handlers.has('new-readings')).toBe(true);
  });

  it('should unbind both events on unmount', () => {
    const { unmount } = render(
      <PusherProvider>
        <Consumer onEvent={jest.fn()} />
      </PusherProvider>
    );

    unmount();

    expect(unbind).toHaveBeenCalledWith('alert-event');
    expect(unbind).toHaveBeenCalledWith('new-readings');
    expect(unsubscribe).toHaveBeenCalledWith('InfraSight');
  });

  it('should stop delivering after a subscriber unmounts', () => {
    const onEvent = jest.fn();
    function Toggle({ show }: { show: boolean }) {
      return (
        <PusherProvider>{show ? <Consumer onEvent={onEvent} /> : null}</PusherProvider>
      );
    }

    const { rerender } = render(<Toggle show />);
    rerender(<Toggle show={false} />);

    act(() => handlers.get('alert-event')?.({ kind: 'fired', alerts: [] }));

    expect(onEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/unit/lib/pusher-alerts.test.tsx`
Expected: FAIL — `usePusherAlerts` is not exported.

- [ ] **Step 3: Extend the Pusher context**

In `lib/pusher-context.tsx`:

```typescript
import type { AlertEvent } from '@/types/v2/alert.types';

type AlertsCallback = (event: AlertEvent) => void;

interface PusherContextValue {
  subscribe: (cb: ReadingsCallback) => void;
  unsubscribe: (cb: ReadingsCallback) => void;
  /** Register a callback that fires for every alert envelope. */
  subscribeAlerts: (cb: AlertsCallback) => void;
  unsubscribeAlerts: (cb: AlertsCallback) => void;
}
```

Inside `PusherProvider`, add a second callback set and bind the new event on the same channel:

```typescript
  const alertCallbacksRef = useRef<Set<AlertsCallback>>(new Set());
```

```typescript
    const alertHandler = (event: AlertEvent) => {
      alertCallbacksRef.current.forEach(cb => {
        try {
          cb(event);
        } catch (err) {
          console.error('PusherProvider: error in alert subscriber callback', err);
        }
      });
    };

    channel.bind('new-readings', handler);
    channel.bind('alert-event', alertHandler);

    return () => {
      channel.unbind('new-readings', handler);
      channel.unbind('alert-event', alertHandler);
      pusher.unsubscribe('InfraSight');
    };
```

Add the two memoized registration functions and include them in the provider value, then export the hook:

```typescript
  const subscribeAlerts = useCallback((cb: AlertsCallback) => {
    alertCallbacksRef.current.add(cb);
  }, []);

  const unsubscribeAlerts = useCallback((cb: AlertsCallback) => {
    alertCallbacksRef.current.delete(cb);
  }, []);
```

```typescript
/**
 * Hook for components that need to react to real-time alert envelopes.
 *
 * The callback is held in a ref so a caller that does not memoize will not cause
 * a re-subscribe on every render. The ref is refreshed in a commit-phase effect
 * rather than assigned during render: assigning during render violates
 * react-hooks/refs, and Pusher handlers only ever read the ref asynchronously,
 * long after commit.
 */
export function usePusherAlerts(callback: AlertsCallback): void {
  const ctx = useContext(PusherContext);

  const callbackRef = useRef<AlertsCallback>(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!ctx) {
      console.warn(
        'usePusherAlerts: PusherProvider is not in the component tree. Real-time alerts are disabled.'
      );
      return;
    }

    const stableCallback: AlertsCallback = event => {
      callbackRef.current(event);
    };

    ctx.subscribeAlerts(stableCallback);
    return () => {
      ctx.unsubscribeAlerts(stableCallback);
    };
  }, [ctx]);
}
```

Also export the `AlertsCallback` type.

**Do NOT modify the existing `usePusherReadings` — it already has this shape.** An earlier draft of this plan told you to fix it here, because it used to assign the ref during render and that was one of the repo's baseline lint problems (`lib/pusher-context.tsx | react-hooks/refs`). `main`'s b43468d already fixed it. As of this branch, `lib/pusher-context.tsx:105-109` reads:

```typescript
  const callbackRef = useRef<ReadingsCallback>(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
```

So the human ruling that both hooks must be lint-clean is already satisfied for the readings hook. **Copy that shape verbatim for `usePusherAlerts`, including the `[callback]` dependency array** — the code block above for `usePusherAlerts` omits the array, which also lints clean but makes the two sibling hooks gratuitously different. Match the file. `pnpm lint` must report **0** problems afterwards.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/unit/lib/pusher-alerts.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the toaster**

Create `components/alerts/AlertToaster.tsx`:

```typescript
'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { usePusherAlerts } from '@/lib/pusher-context';
import { queryKeys } from '@/lib/query/queryClient';
import type { AlertEvent, AlertSeverity } from '@/types/v2';

const TOAST_TYPE: Record<AlertSeverity, 'error' | 'warning' | 'info'> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

/**
 * Raises toasts for alerts that start firing and keeps the cached alert list in
 * step with what the server just did. Renders nothing.
 *
 * Only `fired` raises a toast. `resolved` is broadcast so open lists reconcile
 * without a refetch, but a popup per device when a floor-wide condition clears
 * is noise. Because firing is always system-generated, no viewer can ever cause a
 * toast with their own acknowledge or resolve — the acting admin gets feedback
 * from their own mutation instead.
 */
export function AlertToaster() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleEvent = useCallback(
    (event: AlertEvent) => {
      switch (event.kind) {
        case 'fired':
          for (const alert of event.alerts)
            toast[TOAST_TYPE[alert.severity]](
              `${alert.rule_name} — ${alert.device_id} (${alert.trigger_value})`,
              { onClick: () => router.push(`/alerts/${alert._id}`) }
            );
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;

        case 'resolved':
          // No toast: reconcile silently.
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;

        case 'storm':
          // The storm envelope deliberately carries no rows, so there is nothing
          // to patch — invalidate and let the list refetch.
          //
          // Only a FIRED storm toasts. A resolved storm is a mass recovery, and
          // announcing it with the same red banner would report the best news in
          // the app as the worst. It still invalidates, so lists reconcile.
          if (event.of === 'fired')
            toast.error(`${event.count} alerts firing`, {
              onClick: () => router.push('/alerts'),
            });
          queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
          break;
      }
    },
    [queryClient, router]
  );

  usePusherAlerts(handleEvent);

  return null;
}

export default AlertToaster;
```

- [ ] **Step 5b: Test the toaster's branching**

`AlertToaster` decides which events become popups and which reconcile silently. That decision is the whole component; it needs its own test. Create `__tests__/unit/components/AlertToaster.test.tsx`, mocking `react-toastify`, `next/navigation`, and `usePusherAlerts` so you can hand the component an envelope directly:

Cover, at minimum:

| Envelope | Expected |
| --- | --- |
| `{ kind: 'fired', alerts: [critical, info] }` | `toast.error` once **and** `toast.info` once — severity maps to toast type |
| `{ kind: 'resolved', alerts: [...] }` | **no toast at all**, but `invalidateQueries` still called |
| `{ kind: 'storm', of: 'fired', count: 312 }` | one `toast.error` mentioning 312 |
| `{ kind: 'storm', of: 'resolved', count: 312 }` | **no toast**, `invalidateQueries` still called |

The last two rows are the point: assert both that the fired storm toasts *and* that the resolved storm does not. A test that only checks the fired case passes just as happily against a component that toasts unconditionally.

Assert `invalidateQueries` fires on **every** branch — that is what keeps open lists and the nav badge honest, and it is easy to lose when adding an early return for the silent cases.

- [ ] **Step 6: Mount the toaster**

Render `<AlertToaster />` once, inside the same provider tree that already hosts `PusherProvider` and the React Query provider in `app/layout.tsx`. Confirm `react-toastify`'s `<ToastContainer />` is already mounted there; if it is not, add it alongside.

- [ ] **Step 7: Verify the app builds**

Run: `npx tsc --noEmit && pnpm build`
Expected: clean build. A failure mentioning `mongoose` inside a client component means `types/v2/alert.types.ts` picked up a server-only import — it must stay dependency-free.

- [ ] **Step 8: Commit**

```bash
git add types/v2/alert.types.ts lib/alerting/notify.ts __tests__/unit/lib/alerting/notify.test.ts
git commit -m "feat(alerting): tag storm envelopes with their direction"

git add lib/pusher-context.tsx components/alerts/AlertToaster.tsx app/layout.tsx __tests__/unit/lib/pusher-alerts.test.tsx __tests__/unit/components/AlertToaster.test.tsx
git commit -m "feat(alerting): subscribe to alert events and toast on fire"
```

---

