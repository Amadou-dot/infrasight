'use client';

import { useState } from 'react';
import { Github, X } from 'lucide-react';
import { isDemoModeClient } from '@/lib/auth/rbac-client';

const REPO_URL = 'https://github.com/Amadou-dot/infrasight';

/**
 * Identifies a deployment as a public read-only demo.
 *
 * Renders nothing outside demo mode, so it is safe to mount unconditionally in the
 * root layout.
 */
export default function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (!isDemoModeClient() || dismissed) return null;

  return (
    <div className="w-full border-b border-border bg-muted/50 px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Read-only demo.</span>{' '}
          <span className="hidden sm:inline">
            Browse freely — actions that change data are disabled.
          </span>
        </p>

        <div className="flex items-center gap-1">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Source</span>
          </a>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss demo banner"
            className="inline-flex items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
