import Link from 'next/link';
import { Compass, LayoutDashboard, Monitor } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-6">
        <Compass className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      </div>

      <p className="text-sm font-medium text-muted-foreground mb-2">404</p>
      <h1 className="text-2xl font-bold text-foreground mb-2">This page does not exist</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        The page you are looking for may have been moved, or the device you are after may have
        been removed.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90"
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
          Back to dashboard
        </Link>
        <Link
          href="/devices"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Monitor className="h-4 w-4" aria-hidden="true" />
          Browse devices
        </Link>
      </div>
    </div>
  );
}
