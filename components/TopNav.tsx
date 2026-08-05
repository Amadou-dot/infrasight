'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Monitor,
  Wrench,
  BarChart3,
  Map,
  Menu,
  X,
  ArchiveX,
  Bell,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';
import { SignedIn, SignedOut, SignInButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { UserButtonWithTheme } from '@/components/user-button-with-theme';
import { useRbac } from '@/lib/auth/rbac-client';
import { useOpenAlertCount } from '@/lib/query/hooks';
import { usePusherAlerts } from '@/lib/pusher-context';
import { queryKeys } from '@/lib/query/queryClient';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/devices', label: 'Devices', icon: Monitor },
  { href: '/devices/deleted', label: 'Deleted Devices', icon: ArchiveX, adminOnly: true },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/floor-plan', label: 'Floor Plan', icon: Map },
];

/**
 * The '/alerts' nav item's count affordance — shared by desktop and mobile
 * nav so the two sites can't drift out of sync (review finding A1 flagged
 * exactly that: "both badge sites are gated on `> 0`").
 *
 * A failed fetch renders a visually distinct DEGRADED badge (muted/amber
 * "!") rather than silently falling back to the all-clear (no badge) — the
 * two states must never be pixel-identical. `degraded` wins over `count`
 * unconditionally: even a stale non-zero count sitting in the cache during a
 * failed background refetch should not be trusted over the fact that the
 * fetch just failed.
 */
function AlertCountBadge({ count, degraded }: { count: number; degraded: boolean }) {
  if (degraded) {
    return (
      <span
        aria-label="Open alert count unavailable"
        title="Open alert count unavailable"
        className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-100 px-1.5 text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
      >
        !
      </span>
    );
  }

  if (count <= 0) return null;

  return (
    <span
      aria-label={`${count} open alerts`}
      className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground"
    >
      {count}
    </span>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAdmin, isLoaded, isSignedIn } = useRbac();
  const queryClient = useQueryClient();
  // pagination.total off a one-row page — see useOpenAlertCount's own doc
  // comment for why this beats useAlertsList({ limit: 100 }).data?.length.
  const { data: openAlertCount = 0, error: openAlertCountError } = useOpenAlertCount();
  // A failed fetch must never render as the all-clear (review finding A1): a
  // 500, an expired session, or a Mongo timeout used to default straight to
  // 0 via the destructure above, which is pixel-identical to "zero open
  // alerts" on every page in the app. Gated on isLoaded && isSignedIn so the
  // signed-out / still-loading render — where the query may legitimately
  // 401 or simply hasn't resolved yet — never trips the degraded badge; only
  // a fetch failure for an actually-authenticated viewer counts as degraded.
  const openAlertCountDegraded = Boolean(isLoaded && isSignedIn && openAlertCountError);

  // Same invalidation AlertToaster performs, so the badge updates on the
  // same event that raises a toast. Memoized for a stable callback identity:
  // usePusherAlerts holds the callback in a ref (see its own doc comment), so
  // a non-memoized version here would not actually cause extra re-subscribes
  // — but a stable reference is still good practice and keeps this
  // useCallback's dependency array honest.
  const handleAlertEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
  }, [queryClient]);
  usePusherAlerts(handleAlertEvent);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur-md supports-backdrop-filter:bg-background/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo and Brand */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <Logo className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold text-foreground hidden sm:block">Infrasight</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navItems
              .filter(item => !item.adminOnly || isAdmin)
              .map(item => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {item.href === '/alerts' && (
                    <AlertCountBadge count={openAlertCount} degraded={openAlertCountDegraded} />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right side: User (with theme toggle inside) */}
          <div className="flex items-center gap-2">
            <SignedIn>
              <UserButtonWithTheme />
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="outline" size="sm">
                  Sign In
                </Button>
              </SignInButton>
            </SignedOut>

            {/* Mobile menu button */}
            <button
              type="button"
              className="md:hidden inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <span className="sr-only">Open main menu</span>
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden pb-4 border-t border-border mt-2 pt-4">
            <div className="flex flex-col gap-1">
            {navItems
              .filter(item => !item.adminOnly || isAdmin)
              .map(item => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                    {item.href === '/alerts' && (
                      <AlertCountBadge count={openAlertCount} degraded={openAlertCountDegraded} />
                    )}
                  </Link>
                );
                })}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
