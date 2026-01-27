'use client';

import { Card, CardContent } from '@/components/ui/card';

// ============================================================================
// TYPES
// ============================================================================

export interface DeviceCardSkeletonProps {
  count?: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function DeviceCardSkeleton({ count = 8 }: DeviceCardSkeletonProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {[...Array(count)].map((_, i) => (
        <Card key={i} className="bg-card border-border">
          <CardContent className="p-4">
            <div className="animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 bg-muted rounded-lg" />
                <div className="flex-1">
                  <div className="h-4 w-24 bg-muted rounded mb-1" />
                  <div className="h-3 w-16 bg-muted rounded" />
                </div>
              </div>
              <div className="h-3 w-full bg-muted rounded mb-2" />
              <div className="h-3 w-2/3 bg-muted rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
