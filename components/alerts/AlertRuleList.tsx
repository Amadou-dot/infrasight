'use client';

import { useState } from 'react';
import { toast } from 'react-toastify';
import { RefreshCw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import { describeCondition } from './AlertList';
import { useAlertRulesList, useUpdateAlertRule, useDeleteAlertRule } from '@/lib/query/hooks';
import { useAdminAction } from '@/lib/auth/rbac-client';
import type { AlertRuleV2Response, AlertRuleSelector } from '@/types/v2';

const PAGE_SIZE = 10;

/**
 * Flattens the selector's dimensions into display chips: reading types, then
 * location/tag constraints.
 *
 * `selector` is typed as required on `AlertRuleV2Response`, but a rule with no
 * constraints at all (e.g. the seeded "Low battery" rule, which deliberately
 * has no `selector.types` -- battery is a device property) is persisted with
 * `selector: {}`, and Mongoose's default `minimize` behavior strips that empty
 * object entirely before it reaches Mongo. The field is genuinely absent on
 * read, exactly the runtime shape `matchesSelector` (lib/alerting/selector.ts)
 * and the rule bucketer (lib/alerting/rule-cache.ts) already guard against --
 * this mirrors that same optional-chaining convention rather than trusting
 * the (inaccurate, for this one case) non-optional type.
 */
function selectorChips(selector: AlertRuleSelector | undefined): string[] {
  const chips: string[] = [...(selector?.types ?? [])];
  if (selector?.building_id) chips.push(selector.building_id);
  if (selector?.floor !== undefined) chips.push(`Floor ${selector.floor}`);
  if (selector?.zone) chips.push(selector.zone);
  chips.push(...(selector?.tags ?? []));
  return chips;
}

export function AlertRuleList() {
  // Same useAdminAction() contract as AlertList.tsx's Acknowledge/Resolve and
  // app/analytics/page.tsx's report button: enabled for admins; visible-but-
  // disabled with a tooltip in demo mode; hidden otherwise. requireAdmin()
  // server-side is the real enforcement in every case. Two calls (rather than
  // one shared value) name the two actions distinctly.
  const toggleAction = useAdminAction();
  const deleteAction = useAdminAction();

  const [page, setPage] = useState(1);
  const [ruleToDelete, setRuleToDelete] = useState<AlertRuleV2Response | null>(null);

  const { data: rules, isLoading, error, refetch } = useAlertRulesList({
    page,
    limit: PAGE_SIZE,
  });
  const updateRule = useUpdateAlertRule();
  const deleteRule = useDeleteAlertRule();

  const handleToggle = (rule: AlertRuleV2Response) => {
    updateRule.mutate(
      { id: rule._id, data: { enabled: !rule.enabled } },
      {
        onSuccess: () => toast.success(rule.enabled ? 'Rule disabled' : 'Rule enabled'),
        onError: (err: Error) => toast.error(err.message),
      }
    );
  };

  // Never window.confirm (it blocks the page) — an AlertDialog drives an
  // inline confirm state instead, matching app/devices/page.tsx's delete flow.
  const handleDeleteConfirm = (e: React.MouseEvent) => {
    // Prevent AlertDialogAction's default close behavior so the dialog stays
    // open (showing a pending/disabled state) until the mutation settles.
    e.preventDefault();
    if (!ruleToDelete) return;

    deleteRule.mutate(ruleToDelete._id, {
      onSuccess: () => {
        toast.success('Alert rule deleted');
        setRuleToDelete(null);
      },
      onError: (err: Error) => toast.error(err.message),
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Alert Rules</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {error && !isLoading && (
          <p className="py-8 text-center text-sm text-destructive">Failed to load alert rules</p>
        )}

        {!isLoading && !error && rules?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No alert rules.</p>
        )}

        <ul className="divide-y divide-border">
          {rules?.map(rule => (
            <li key={rule._id} className="flex flex-wrap items-center gap-3 py-3">
              {toggleAction.visible && (
                <Checkbox
                  aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`}
                  checked={rule.enabled}
                  disabled={toggleAction.disabled || updateRule.isPending}
                  title={toggleAction.tooltip}
                  onCheckedChange={() => handleToggle(rule)}
                />
              )}

              <span className="font-medium">{rule.name}</span>
              <AlertSeverityBadge severity={rule.severity} />
              <span className="text-sm text-muted-foreground">{describeCondition(rule)}</span>

              <div className="flex flex-wrap gap-1">
                {selectorChips(rule.selector).map(chip => (
                  <Badge key={chip} variant="secondary">
                    {chip}
                  </Badge>
                ))}
              </div>

              {deleteAction.visible && (
                <div className="ml-auto">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${rule.name}`}
                    disabled={deleteAction.disabled || deleteRule.isPending}
                    title={deleteAction.tooltip}
                    onClick={() => setRuleToDelete(rule)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={(rules?.length ?? 0) < PAGE_SIZE}
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>

      <AlertDialog
        open={!!ruleToDelete}
        onOpenChange={open => {
          if (!deleteRule.isPending && !open) setRuleToDelete(null);
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={e => deleteRule.isPending && e.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Alert Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold">{ruleToDelete?.name}</span>? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setRuleToDelete(null)}
              disabled={deleteRule.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteRule.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default AlertRuleList;
