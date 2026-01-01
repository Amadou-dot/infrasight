'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface TimelineTask {
  id: string;
  deviceId: string;
  deviceName: string;
  taskType: 'emergency' | 'firmware' | 'calibration' | 'routine';
  startDate: Date;
  endDate: Date;
  label: string;
}

interface MaintenanceTimelineProps {
  tasks?: TimelineTask[];
  loading?: boolean;
}

type ViewMode = 'day' | 'week' | 'month';

// Generate demo tasks for display
function generateDemoTasks(): TimelineTask[] {
  const today = new Date();
  return [
    {
      id: '1',
      deviceId: 'sensor-x99',
      deviceName: 'Sensor-X99',
      taskType: 'emergency',
      startDate: today,
      endDate: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
      label: 'EMERGENCY FIX',
    },
    {
      id: '2',
      deviceId: 'gateway-04',
      deviceName: 'Gateway-04',
      taskType: 'firmware',
      startDate: new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000),
      endDate: new Date(today.getTime() + 4 * 24 * 60 * 60 * 1000),
      label: 'FW UPDATE',
    },
    {
      id: '3',
      deviceId: 'hvac-ctrl',
      deviceName: 'HVAC-Ctrl',
      taskType: 'calibration',
      startDate: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000),
      endDate: new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000),
      label: 'CALIBRATION',
    },
  ];
}

function getTaskColor(type: TimelineTask['taskType']): string {
  switch (type) {
    case 'emergency':
      return 'bg-red-500';
    case 'firmware':
      return 'bg-amber-500';
    case 'calibration':
      return 'bg-sky-500';
    case 'routine':
      return 'bg-emerald-500';
    default:
      return 'bg-gray-500';
  }
}

function getDateLabels(viewMode: ViewMode): string[] {
  const today = new Date();
  const labels: string[] = ['Today'];
  const daysToShow = viewMode === 'day' ? 1 : viewMode === 'week' ? 6 : 30;
  
  for (let i = 1; i <= daysToShow; i++) {
    const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  
  return labels;
}

export default function MaintenanceTimeline({
  tasks,
  loading = false,
}: MaintenanceTimelineProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  
  const displayTasks = tasks || generateDemoTasks();
  const dateLabels = getDateLabels(viewMode);

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-lg font-semibold">Upcoming Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-full" />
            <div className="h-12 bg-muted rounded w-full" />
            <div className="h-12 bg-muted rounded w-full" />
            <div className="h-12 bg-muted rounded w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-lg font-semibold">Upcoming Timeline</CardTitle>
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
            <Button
              key={mode}
              variant={viewMode === mode ? 'default' : 'ghost'}
              size="sm"
              className="text-xs capitalize px-3"
              onClick={() => setViewMode(mode)}
            >
              {mode}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Date headers */}
            <div className="grid gap-0 mb-4" style={{ gridTemplateColumns: `120px repeat(${dateLabels.length}, 1fr)` }}>
              <div /> {/* Empty cell for device name column */}
              {dateLabels.map((label, idx) => (
                <div
                  key={idx}
                  className="text-xs text-muted-foreground text-center py-2"
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Task rows */}
            <div className="space-y-3">
              {displayTasks.map((task) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const startOffset = Math.floor((task.startDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
                const duration = Math.max(1, Math.ceil((task.endDate.getTime() - task.startDate.getTime()) / (24 * 60 * 60 * 1000)));
                const totalDays = dateLabels.length;
                
                const startPercent = Math.max(0, (startOffset / totalDays) * 100);
                const widthPercent = Math.min((duration / totalDays) * 100, 100 - startPercent);

                return (
                  <div
                    key={task.id}
                    className="grid gap-0 items-center"
                    style={{ gridTemplateColumns: `120px 1fr` }}
                  >
                    <div className="text-sm font-medium text-foreground truncate pr-4">
                      {task.deviceName}
                    </div>
                    <div className="relative h-8 bg-muted/30 rounded">
                      <div
                        className={`absolute h-full rounded ${getTaskColor(task.taskType)} flex items-center justify-center`}
                        style={{
                          left: `${startPercent}%`,
                          width: `${widthPercent}%`,
                          minWidth: '80px',
                        }}
                      >
                        <span className="text-xs font-medium text-white px-2 truncate">
                          {task.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
