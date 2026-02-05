'use client';

import { Badge } from '@/components/ui/badge';
import { Clock, CheckCircle, XCircle } from 'lucide-react';
import type { ScheduleStatus } from '@/types/v2';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface ScheduleStatusBadgeProps {
  status: ScheduleStatus;
  className?: string;
  showIcon?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_CONFIG: Record<
  ScheduleStatus,
  { label: string; className: string; icon: typeof Clock }
> = {
  scheduled: {
    label: 'Scheduled',
    className: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    icon: Clock,
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
    icon: CheckCircle,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
    icon: XCircle,
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ScheduleStatusBadge({
  status,
  className,
  showIcon = true,
}: ScheduleStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

export default ScheduleStatusBadge;
