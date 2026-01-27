'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
  maxTasks?: number;
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

/**
 * Get unique dates from tasks that have scheduled maintenance
 */
function getUniqueDatesFromTasks(tasks: TimelineTask[]): Date[] {
  const dateSet = new Set<string>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Always include today
  dateSet.add(today.toISOString().split('T')[0]);

  tasks.forEach(task => {
    const startDate = new Date(task.startDate);
    startDate.setHours(0, 0, 0, 0);

    // Add each day the task spans
    const endDate = new Date(task.endDate);
    endDate.setHours(0, 0, 0, 0);

    let current = new Date(startDate);
    while (current <= endDate) {
      dateSet.add(current.toISOString().split('T')[0]);
      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    }
  });

  // Convert to sorted array of dates
  return Array.from(dateSet)
    .sort()
    .map(dateStr => new Date(dateStr));
}

/**
 * Format date for display
 */
function formatDateLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compareDate = new Date(date);
  compareDate.setHours(0, 0, 0, 0);

  if (compareDate.getTime() === today.getTime()) return 'Today';

  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (compareDate.getTime() === tomorrow.getTime()) return 'Tomorrow';

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MaintenanceTimeline({
  tasks = [],
  loading = false,
  maxTasks = 20,
}: MaintenanceTimelineProps) {
  // Sort tasks by start date and take only the closest N
  const displayTasks = useMemo(() => {
    const now = new Date();
    return [...tasks]
      .filter(task => task.startDate >= now || task.endDate >= now) // Only future/ongoing tasks
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .slice(0, maxTasks);
  }, [tasks, maxTasks]);

  // Get only dates that have tasks
  const scheduledDates = useMemo(() => getUniqueDatesFromTasks(displayTasks), [displayTasks]);
  const dateLabels = scheduledDates.map(formatDateLabel);

  if (loading)
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

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-lg font-semibold">Upcoming Timeline</CardTitle>
        {displayTasks.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Showing {displayTasks.length} of {tasks.length} tasks
          </span>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {displayTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-muted-foreground mb-2">No upcoming maintenance tasks</div>
            <div className="text-xs text-muted-foreground/70">
              All devices are healthy with no scheduled maintenance
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-150">
              {/* Date headers */}
              <div
                className="grid gap-0 mb-4"
                style={{ gridTemplateColumns: `120px repeat(${dateLabels.length}, 1fr)` }}
              >
                <div /> {/* Empty cell for device name column */}
                {dateLabels.map((label, idx) => (
                  <div key={idx} className="text-xs text-muted-foreground text-center py-2">
                    {label}
                  </div>
                ))}
              </div>

              {/* Task rows */}
              <div className="space-y-3">
                {displayTasks.map(task => {
                  // Find which column(s) this task should span
                  const taskStartDate = new Date(task.startDate);
                  taskStartDate.setHours(0, 0, 0, 0);
                  const taskEndDate = new Date(task.endDate);
                  taskEndDate.setHours(0, 0, 0, 0);

                  // Find the index of the start date column
                  const startColIndex = scheduledDates.findIndex(d => {
                    const compareDate = new Date(d);
                    compareDate.setHours(0, 0, 0, 0);
                    return compareDate.getTime() >= taskStartDate.getTime();
                  });

                  // Find how many columns this task spans
                  let endColIndex = startColIndex;
                  for (let i = startColIndex; i < scheduledDates.length; i++) {
                    const colDate = new Date(scheduledDates[i]);
                    colDate.setHours(0, 0, 0, 0);
                    if (colDate <= taskEndDate) endColIndex = i;
                  }

                  const colSpan = Math.max(1, endColIndex - startColIndex + 1);
                  const totalCols = scheduledDates.length;

                  const startPercent = (startColIndex / totalCols) * 100;
                  const widthPercent = (colSpan / totalCols) * 100;

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
                            width: `${Math.max(widthPercent, 10)}%`,
                            minWidth: '70px',
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
        )}
      </CardContent>
    </Card>
  );
}
