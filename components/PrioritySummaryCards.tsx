'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { v2Api, type HealthMetrics, type AnomalyResponse } from '@/lib/api/v2-client';
import type { MaintenanceForecastResponse } from '@/types/v2';
import { AlertTriangle, Wrench, Activity, TrendingUp } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface PrioritySummaryCardsProps {
  onCardClick?: (filter: CardFilter) => void;
}

export type CardFilter = 
  | { type: 'critical' }
  | { type: 'maintenance' }
  | { type: 'health' }
  | { type: 'anomalies' };

interface SummaryCard {
  id: string;
  title: string;
  metric: number | string;
  subtext: string;
  icon: React.ReactNode;
  colorClass: string;
  filter: CardFilter;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function PrioritySummaryCards({ onCardClick }: PrioritySummaryCardsProps) {
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [forecast, setForecast] = useState<MaintenanceForecastResponse | null>(
    null
  );
  const [anomalies, setAnomalies] = useState<AnomalyResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch all data in parallel
  const fetchData = async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [healthRes, forecastRes, anomaliesRes] = await Promise.all([
        v2Api.analytics.health(),
        v2Api.analytics.maintenanceForecast({ days_ahead: 7 }),
        v2Api.analytics.anomalies({ limit: 100 }),
      ]);

      setHealth(healthRes.data);
      setForecast(forecastRes.data);
      setAnomalies(anomaliesRes.data);
    } catch (err) {
      console.error('Failed to fetch summary data:', err);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // Initial fetch with loading indicator
  useEffect(() => {
    fetchData(true);
  }, []);

  // Auto-refresh every 30 seconds without loading indicator
  useEffect(() => {
    const interval = setInterval(() => fetchData(false), 30000);
    return () => clearInterval(interval);
  }, []);

  // Calculate critical issues count
  const criticalCount = health
    ? (health.alerts.offline_devices.count || 0) +
      (health.alerts.error_devices.count || 0) +
      (health.alerts.low_battery_devices.count || 0) +
      (forecast?.summary.maintenance_overdue.length || 0)
    : 0;

  // Calculate maintenance due count (critical + warning from forecast)
  const maintenanceDueCount = forecast
    ? forecast.critical.length + forecast.warning.length
    : 0;

  // Calculate health score
  const healthScore = health?.summary.health_score || 0;
  const healthPercent = `${Math.round(healthScore)}%`;

  // Get health color based on score
  const getHealthColor = (score: number): string => {
    if (score >= 90)
      return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-500';
    if (score >= 70)
      return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-500';
    return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-500';
  };

  // Calculate anomalies in last 24h
  const anomaliesCount = anomalies?.pagination.total || 0;

  // Define cards
  const cards: SummaryCard[] = [
    {
      id: 'critical',
      title: 'Critical Issues',
      metric: criticalCount,
      subtext: 'Require immediate attention',
      icon: <AlertTriangle className='h-6 w-6' />,
      colorClass:
        'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-500',
      filter: { type: 'critical' },
    },
    {
      id: 'maintenance',
      title: 'Maintenance Due',
      metric: maintenanceDueCount,
      subtext: 'Within 7 days',
      icon: <Wrench className='h-6 w-6' />,
      colorClass:
        'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-500',
      filter: { type: 'maintenance' },
    },
    {
      id: 'health',
      title: 'System Health',
      metric: healthPercent,
      subtext: 'Uptime average',
      icon: <Activity className='h-6 w-6' />,
      colorClass: getHealthColor(healthScore),
      filter: { type: 'health' },
    },
    {
      id: 'anomalies',
      title: 'Anomalies',
      metric: anomaliesCount,
      subtext: 'Pattern deviations',
      icon: <TrendingUp className='h-6 w-6' />,
      colorClass:
        'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-500',
      filter: { type: 'anomalies' },
    },
  ];

  // Loading skeleton
  if (loading) {
    return (
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className='animate-pulse'>
            <CardContent className='p-6'>
              <div className='h-12 bg-muted rounded mb-2'></div>
              <div className='h-8 bg-muted rounded mb-2'></div>
              <div className='h-4 bg-muted rounded'></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
      {cards.map(card => (
        <Card
          key={card.id}
          className={`cursor-pointer transition-all hover:shadow-lg hover:scale-105 border-l-4 ${card.colorClass}`}
          onClick={() => onCardClick?.(card.filter)}>
          <CardContent className='p-6'>
            <div className='flex items-center justify-between mb-4'>
              <div className={`p-2 rounded-lg ${card.colorClass}`}>
                {card.icon}
              </div>
            </div>
            <div className='space-y-1'>
              <p className='text-2xl font-bold'>{card.metric}</p>
              <p className='text-sm font-medium'>{card.title}</p>
              <p className='text-xs text-muted-foreground'>{card.subtext}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
