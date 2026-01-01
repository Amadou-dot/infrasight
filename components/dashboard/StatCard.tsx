'use client';

import { cn } from '@/lib/utils';
import { type LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  onClick?: () => void;
}

export default function StatCard({
  title,
  value,
  icon: Icon,
  iconColor,
  iconBgColor,
  trend,
  onClick,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-xl p-5 flex items-center gap-4 transition-all duration-200',
        onClick && 'cursor-pointer hover:bg-muted hover:shadow-lg'
      )}
      onClick={onClick}
    >
      {/* Icon */}
      <div className={cn('p-3 rounded-xl', iconBgColor)}>
        <Icon className={cn('h-6 w-6', iconColor)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-muted-foreground mb-1">{title}</p>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </div>

      {/* Trend indicator */}
      {trend && (
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium',
            trend.isPositive
              ? 'bg-green-500/10 text-green-400'
              : 'bg-red-500/10 text-red-400'
          )}
        >
          <span>{trend.isPositive ? '↗' : '↘'}</span>
          <span>{trend.isPositive ? '+' : ''}{trend.value}%</span>
        </div>
      )}
    </div>
  );
}
