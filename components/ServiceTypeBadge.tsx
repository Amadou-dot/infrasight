'use client';

import { Badge } from '@/components/ui/badge';
import { Download, Crosshair, AlertTriangle, Wrench } from 'lucide-react';
import type { ServiceType } from '@/types/v2';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface ServiceTypeBadgeProps {
  serviceType: ServiceType;
  className?: string;
  showIcon?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SERVICE_TYPE_CONFIG: Record<
  ServiceType,
  { label: string; className: string; icon: typeof Download }
> = {
  firmware_update: {
    label: 'Firmware Update',
    className: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
    icon: Download,
  },
  calibration: {
    label: 'Calibration',
    className: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
    icon: Crosshair,
  },
  emergency_fix: {
    label: 'Emergency Fix',
    className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    icon: AlertTriangle,
  },
  general_maintenance: {
    label: 'General Maintenance',
    className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    icon: Wrench,
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ServiceTypeBadge({
  serviceType,
  className,
  showIcon = true,
}: ServiceTypeBadgeProps) {
  const config = SERVICE_TYPE_CONFIG[serviceType];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

export default ServiceTypeBadge;
