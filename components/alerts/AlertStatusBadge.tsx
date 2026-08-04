'use client';

import { Badge } from '@/components/ui/badge';
import { Clock, Zap, Eye, CheckCircle } from 'lucide-react';
import type { AlertStatus } from '@/types/v2';
import { cn } from '@/lib/utils';

interface AlertStatusBadgeProps {
  status: AlertStatus;
  className?: string;
  showIcon?: boolean;
}

const STATUS_CONFIG: Record<
  AlertStatus,
  { label: string; className: string; icon: typeof Clock }
> = {
  pending: {
    label: 'Pending',
    className:
      'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
    icon: Clock,
  },
  firing: {
    label: 'Firing',
    className:
      'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    icon: Zap,
  },
  acknowledged: {
    label: 'Acknowledged',
    className:
      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    icon: Eye,
  },
  resolved: {
    label: 'Resolved',
    className:
      'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
    icon: CheckCircle,
  },
};

export function AlertStatusBadge({
  status,
  className,
  showIcon = true,
}: AlertStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

export default AlertStatusBadge;
