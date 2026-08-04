'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bell, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertRuleList } from '@/components/alerts/AlertRuleList';
import { CreateAlertRuleModal } from '@/components/alerts/CreateAlertRuleModal';
import { useAdminAction } from '@/lib/auth/rbac-client';

/**
 * Rule management: list, create, and delete alert rules. Mirrors
 * app/alerts/page.tsx's header shell, with a back link to the active-alerts
 * view rather than a Suspense boundary — AlertRuleList keeps its filter/page
 * state local (no useSearchParams), unlike AlertList.
 */
export default function AlertRulesPage() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  // Same useAdminAction() contract as app/analytics/page.tsx's report button:
  // enabled for admins; visible-but-disabled with a tooltip in demo mode;
  // hidden otherwise. requireAdmin() server-side remains the real enforcement.
  const newRuleAction = useAdminAction();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <header className="mb-6 space-y-4">
        <Link
          href="/alerts"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to alerts
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bell className="h-7 w-7 text-primary" aria-hidden="true" />
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Alert Rules</h1>
          </div>
          {newRuleAction.visible && (
            <Button
              size="sm"
              disabled={newRuleAction.disabled}
              title={newRuleAction.tooltip}
              onClick={() => setCreateModalOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              New rule
            </Button>
          )}
        </div>
      </header>

      <AlertRuleList />

      <CreateAlertRuleModal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} />
    </div>
  );
}
