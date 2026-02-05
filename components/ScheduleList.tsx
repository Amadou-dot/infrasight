'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ScheduleStatusBadge } from '@/components/ScheduleStatusBadge';
import { ServiceTypeBadge } from '@/components/ServiceTypeBadge';
import {
  useSchedulesList,
  useCompleteSchedule,
  useCancelSchedule,
} from '@/lib/query/hooks';
import { useRbac } from '@/lib/auth/rbac-client';
import { toast } from 'react-toastify';
import {
  Calendar,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
} from 'lucide-react';
import type { ScheduleStatus, ServiceType, ListSchedulesQuery } from '@/types/v2';

// ============================================================================
// TYPES
// ============================================================================

interface ScheduleListProps {
  /** Initial filters */
  initialFilters?: Partial<ListSchedulesQuery>;
  /** Show header with title */
  showHeader?: boolean;
  /** Callback when a schedule is clicked */
  onScheduleClick?: (scheduleId: string) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const SERVICE_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'firmware_update', label: 'Firmware Update' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'emergency_fix', label: 'Emergency Fix' },
  { value: 'general_maintenance', label: 'General Maintenance' },
];

const PAGE_SIZE = 10;

// ============================================================================
// COMPONENT
// ============================================================================

export function ScheduleList({
  initialFilters = {},
  showHeader = true,
  onScheduleClick,
}: ScheduleListProps) {
  const { isAdmin } = useRbac();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('scheduled');
  const [serviceTypeFilter, setServiceTypeFilter] = useState<string>('all');

  // Build query filters
  const queryFilters: ListSchedulesQuery = {
    page,
    limit: PAGE_SIZE,
    sortBy: 'scheduled_date',
    sortDirection: 'asc',
    include_all: statusFilter === 'all',
    ...(statusFilter !== 'all' && { status: statusFilter as ScheduleStatus }),
    ...(serviceTypeFilter !== 'all' && {
      service_type: serviceTypeFilter as ServiceType,
    }),
    ...initialFilters,
  };

  // Fetch schedules
  const {
    data: schedules = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useSchedulesList(queryFilters);

  // Mutations
  const completeSchedule = useCompleteSchedule({
    onSuccess: () => {
      toast.success('Schedule marked as completed');
      refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to complete schedule');
    },
  });

  const cancelSchedule = useCancelSchedule({
    onSuccess: () => {
      toast.success('Schedule cancelled');
      refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel schedule');
    },
  });

  // Handlers
  const handleComplete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Mark this schedule as completed?')) 
      completeSchedule.mutate(id);
    
  };

  const handleCancel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Cancel this schedule?')) 
      cancelSchedule.mutate(id);
    
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Check if date is past
  const isPastDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  // Pagination helpers
  const hasMorePages = schedules.length === PAGE_SIZE;
  const hasPrevPage = page > 1;

  return (
    <Card>
      {showHeader && (
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5 text-blue-500" />
            Scheduled Services
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filters:</span>
          </div>
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            size="sm"
          />
          <Select
            value={serviceTypeFilter}
            onValueChange={(val) => {
              setServiceTypeFilter(val);
              setPage(1);
            }}
            options={SERVICE_TYPE_OPTIONS}
            size="sm"
          />
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse flex items-center gap-4 p-4 bg-muted/50 rounded-lg"
              >
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted-foreground/20 rounded w-1/3" />
                  <div className="h-3 bg-muted-foreground/20 rounded w-1/2" />
                </div>
                <div className="h-6 bg-muted-foreground/20 rounded w-20" />
                <div className="h-6 bg-muted-foreground/20 rounded w-24" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="text-center py-8">
            <p className="text-destructive mb-2">Failed to load schedules</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && schedules.length === 0 && (
          <div className="text-center py-12">
            <Calendar className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <p className="text-muted-foreground mb-1">No schedules found</p>
            <p className="text-sm text-muted-foreground">
              {statusFilter !== 'all' || serviceTypeFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Schedule your first device service to get started'}
            </p>
          </div>
        )}

        {/* Schedule List */}
        {!isLoading && !error && schedules.length > 0 && (
          <div className="space-y-2">
            {schedules.map((schedule) => (
              <div
                key={schedule._id}
                onClick={() => onScheduleClick?.(schedule._id)}
                className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-muted/30 hover:bg-muted/50 rounded-lg transition-colors ${
                  onScheduleClick ? 'cursor-pointer' : ''
                }`}
              >
                {/* Device info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {schedule.device?.serial_number || schedule.device_id}
                    </span>
                  </div>
                  {schedule.device && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {schedule.device.location.building_id} • Floor{' '}
                      {schedule.device.location.floor} • {schedule.device.location.room_name}
                    </div>
                  )}
                  {schedule.notes && (
                    <div className="text-xs text-muted-foreground mt-1 italic truncate">
                      {schedule.notes}
                    </div>
                  )}
                </div>

                {/* Service Type */}
                <div className="shrink-0">
                  <ServiceTypeBadge serviceType={schedule.service_type} />
                </div>

                {/* Scheduled Date */}
                <div className="shrink-0 text-sm">
                  <span
                    className={
                      isPastDate(schedule.scheduled_date) && schedule.status === 'scheduled'
                        ? 'text-destructive font-medium'
                        : 'text-muted-foreground'
                    }
                  >
                    {formatDate(schedule.scheduled_date)}
                  </span>
                  {isPastDate(schedule.scheduled_date) && schedule.status === 'scheduled' && (
                    <span className="block text-xs text-destructive">Overdue</span>
                  )}
                </div>

                {/* Status */}
                <div className="shrink-0">
                  <ScheduleStatusBadge status={schedule.status} />
                </div>

                {/* Actions (Admin only) */}
                {isAdmin && schedule.status === 'scheduled' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleComplete(schedule._id, e)}
                      disabled={completeSchedule.isPending}
                      className="h-8 px-2 text-green-600 hover:text-green-700 hover:bg-green-100 dark:hover:bg-green-900/30"
                      title="Mark as completed"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleCancel(schedule._id, e)}
                      disabled={cancelSchedule.isPending}
                      className="h-8 px-2 text-gray-500 hover:text-destructive hover:bg-destructive/10"
                      title="Cancel schedule"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!isLoading && !error && (schedules.length > 0 || page > 1) && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">Page {page}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!hasPrevPage || isFetching}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMorePages || isFetching}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ScheduleList;
