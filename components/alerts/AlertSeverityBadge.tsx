'use client';

import { Badge } from '@/components/ui/badge';
import { Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import type { AlertSeverity } from '@/types/v2';
import { cn } from '@/lib/utils';

interface AlertSeverityBadgeProps {
  severity: AlertSeverity;
  className?: string;
  showIcon?: boolean;
}

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { label: string; className: string; icon: typeof Info }
> = {
  info: {
    label: 'Info',
    className:
      'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    icon: Info,
  },
  warning: {
    label: 'Warning',
    className:
      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    className:
      'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    icon: AlertOctagon,
  },
};

export function AlertSeverityBadge({
  severity,
  className,
  showIcon = true,
}: AlertSeverityBadgeProps) {
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

export default AlertSeverityBadge;
