'use client';

import { AlertTriangle, Clock, CheckCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface MaintenanceStatusCardsProps {
  criticalCount: number;
  dueForServiceCount: number;
  healthyCount: number;
  criticalNew?: number;
  daysForDue?: number;
  uptimePercentage?: number;
  loading?: boolean;
}

export default function MaintenanceStatusCards({
  criticalCount,
  dueForServiceCount,
  healthyCount,
  criticalNew = 0,
  daysForDue = 7,
  uptimePercentage,
  loading = false,
}: MaintenanceStatusCardsProps) {
  if (loading) 
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-6">
              <div className="animate-pulse">
                <div className="h-4 w-24 bg-muted rounded mb-4" />
                <div className="h-10 w-16 bg-muted rounded mb-2" />
                <div className="h-3 w-32 bg-muted rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Critical Attention Needed */}
      <Card className="bg-card border-border relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
            </div>
            {criticalNew > 0 && (
              <Badge variant="destructive" className="text-xs">
                +{criticalNew} New
              </Badge>
            )}
          </div>
          <div className="mt-4">
            <span className="text-4xl font-bold text-foreground">
              {criticalCount}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Critical Attention Needed
          </p>
        </CardContent>
      </Card>

      {/* Due for Service */}
      <Card className="bg-card border-border relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
            </div>
            <Badge variant="secondary" className="text-xs">
              Next {daysForDue} Days
            </Badge>
          </div>
          <div className="mt-4">
            <span className="text-4xl font-bold text-foreground">
              {dueForServiceCount}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Due for Service
          </p>
        </CardContent>
      </Card>

      {/* Healthy Devices */}
      <Card className="bg-card border-border relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
            {uptimePercentage !== undefined && (
              <Badge className="text-xs bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30">
                {uptimePercentage}% Uptime
              </Badge>
            )}
          </div>
          <div className="mt-4">
            <span className="text-4xl font-bold text-foreground">
              {healthyCount}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Healthy Devices
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
