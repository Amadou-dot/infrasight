'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'react-toastify';
import { Calendar, Loader2, Search, X } from 'lucide-react';
import { useDevicesList, useCreateSchedule } from '@/lib/query/hooks';
import { ApiClientError } from '@/lib/api/v2-client';
import type { ServiceType, DeviceV2Response } from '@/types/v2';

// ============================================================================
// TYPES
// ============================================================================

interface ScheduleServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Pre-select specific devices */
  preselectedDeviceIds?: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SERVICE_TYPES: { value: ServiceType; label: string }[] = [
  { value: 'firmware_update', label: 'Firmware Update' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'emergency_fix', label: 'Emergency Fix' },
  { value: 'general_maintenance', label: 'General Maintenance' },
];

const EMPTY_DEVICE_IDS: string[] = [];

const INITIAL_FORM_DATA = {
  device_ids: [] as string[],
  service_type: 'general_maintenance' as ServiceType,
  scheduled_date: '',
  notes: '',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get tomorrow's date as YYYY-MM-DD string (minimum date for scheduling)
 */
function getMinDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ScheduleServiceModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedDeviceIds = EMPTY_DEVICE_IDS,
}: ScheduleServiceModalProps) {
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [searchQuery, setSearchQuery] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Fetch all active devices for selection
  const { data: devices = [], isLoading: devicesLoading } = useDevicesList({
    status: 'active',
    limit: 500, // Load up to 500 devices for selection
  });

  // Create schedule mutation
  const createSchedule = useCreateSchedule({
    onSuccess: () => {
      toast.success(
        formData.device_ids.length === 1
          ? 'Schedule created successfully'
          : `${formData.device_ids.length} schedules created successfully`
      );
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) 
        switch (err.errorCode) {
          case 'VALIDATION_ERROR':
            setGeneralError(err.message);
            break;
          case 'DEVICE_NOT_FOUND':
            setErrors({ device_ids: 'One or more selected devices not found' });
            break;
          case 'INVALID_SCHEDULED_DATE':
            setErrors({ scheduled_date: 'Scheduled date must be in the future' });
            break;
          default:
            setGeneralError(err.message || 'Failed to create schedule');
        }
       else 
        setGeneralError('An unexpected error occurred');
      
    },
  });

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting form state on modal open is intentional
      setFormData({
        ...INITIAL_FORM_DATA,
        device_ids: preselectedDeviceIds,
        scheduled_date: getMinDate(),
      });
      setSearchQuery('');
      setErrors({});
      setGeneralError(null);
    }
  }, [isOpen, preselectedDeviceIds]);

  // Filter devices based on search query
  const filteredDevices = useMemo(() => {
    if (!searchQuery.trim()) return devices;
    const query = searchQuery.toLowerCase();
    return devices.filter(
      (device) =>
        device._id.toLowerCase().includes(query) ||
        device.serial_number.toLowerCase().includes(query) ||
        device.location?.room_name?.toLowerCase().includes(query) ||
        device.location?.building_id?.toLowerCase().includes(query)
    );
  }, [devices, searchQuery]);

  // Selected devices for display
  const selectedDevices = useMemo(() => {
    return devices.filter((d) => formData.device_ids.includes(d._id));
  }, [devices, formData.device_ids]);

  // Toggle device selection
  const toggleDevice = (deviceId: string) => {
    setFormData((prev) => ({
      ...prev,
      device_ids: prev.device_ids.includes(deviceId)
        ? prev.device_ids.filter((id) => id !== deviceId)
        : [...prev.device_ids, deviceId],
    }));
    if (errors.device_ids) 
      setErrors((prev) => ({ ...prev, device_ids: '' }));
    
  };

  // Select/deselect all filtered devices
  const toggleAllFiltered = () => {
    const filteredIds = filteredDevices.map((d) => d._id);
    const allSelected = filteredIds.every((id) => formData.device_ids.includes(id));

    setFormData((prev) => ({
      ...prev,
      device_ids: allSelected
        ? prev.device_ids.filter((id) => !filteredIds.includes(id))
        : [...new Set([...prev.device_ids, ...filteredIds])],
    }));
  };

  // Clear all selected devices
  const clearAllSelected = () => {
    setFormData((prev) => ({ ...prev, device_ids: [] }));
  };

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (formData.device_ids.length === 0) 
      newErrors.device_ids = 'Select at least one device';
     else if (formData.device_ids.length > 100) 
      newErrors.device_ids = 'Maximum 100 devices can be scheduled at once';
    

    if (!formData.scheduled_date) 
      newErrors.scheduled_date = 'Scheduled date is required';
     else {
      const selectedDate = new Date(formData.scheduled_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (selectedDate <= today) 
        newErrors.scheduled_date = 'Scheduled date must be in the future';
      
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    if (!validateForm()) return;

    createSchedule.mutate({
      device_ids: formData.device_ids,
      service_type: formData.service_type,
      scheduled_date: formData.scheduled_date,
      notes: formData.notes || undefined,
    });
  };

  const isSubmitting = createSchedule.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-500" />
            Schedule Service
          </DialogTitle>
          <DialogDescription>
            Schedule maintenance service for one or more devices. Select devices,
            choose service type, and set the scheduled date.
          </DialogDescription>
        </DialogHeader>

        {generalError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Service Type */}
          <div className="space-y-2">
            <Label htmlFor="service_type">Service Type</Label>
            <Select
              value={formData.service_type}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, service_type: value as ServiceType }))
              }
              options={SERVICE_TYPES}
              className="w-full"
            />
          </div>

          {/* Scheduled Date */}
          <div className="space-y-2">
            <Label htmlFor="scheduled_date">
              Scheduled Date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="scheduled_date"
              type="date"
              value={formData.scheduled_date}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, scheduled_date: e.target.value }));
                if (errors.scheduled_date) 
                  setErrors((prev) => ({ ...prev, scheduled_date: '' }));
                
              }}
              min={getMinDate()}
              error={!!errors.scheduled_date}
            />
            {errors.scheduled_date && (
              <p className="text-xs text-destructive">{errors.scheduled_date}</p>
            )}
          </div>

          {/* Device Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Devices <span className="text-destructive">*</span>
                <span className="ml-2 text-sm text-muted-foreground font-normal">
                  ({formData.device_ids.length} selected)
                </span>
              </Label>
              {formData.device_ids.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllSelected}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Selected devices display */}
            {selectedDevices.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2 bg-muted/50 rounded-md">
                {selectedDevices.slice(0, 5).map((device) => (
                  <span
                    key={device._id}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full"
                  >
                    {device.serial_number}
                    <button
                      type="button"
                      onClick={() => toggleDevice(device._id)}
                      className="hover:text-blue-900 dark:hover:text-blue-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {selectedDevices.length > 5 && (
                  <span className="inline-flex items-center px-2 py-1 text-xs text-muted-foreground">
                    +{selectedDevices.length - 5} more
                  </span>
                )}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, serial number, room, or building..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Device list */}
            <div className="border rounded-md max-h-48 overflow-y-auto">
              {devicesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredDevices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {searchQuery ? 'No devices found matching your search' : 'No devices available'}
                </div>
              ) : (
                <>
                  {/* Select all header */}
                  <div className="sticky top-0 bg-background border-b px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={
                          filteredDevices.length > 0 &&
                          filteredDevices.every((d) => formData.device_ids.includes(d._id))
                        }
                        onCheckedChange={toggleAllFiltered}
                      />
                      <span className="text-sm text-muted-foreground">
                        Select all ({filteredDevices.length})
                      </span>
                    </div>
                  </div>
                  {/* Device rows */}
                  {filteredDevices.map((device) => (
                    <DeviceRow
                      key={device._id}
                      device={device}
                      selected={formData.device_ids.includes(device._id)}
                      onToggle={() => toggleDevice(device._id)}
                    />
                  ))}
                </>
              )}
            </div>
            {errors.device_ids && (
              <p className="text-xs text-destructive">{errors.device_ids}</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Add any additional notes about this maintenance..."
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || formData.device_ids.length === 0}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                `Schedule ${formData.device_ids.length || ''} Device${formData.device_ids.length !== 1 ? 's' : ''}`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DEVICE ROW COMPONENT
// ============================================================================

interface DeviceRowProps {
  device: DeviceV2Response;
  selected: boolean;
  onToggle: () => void;
}

function DeviceRow({ device, selected, onToggle }: DeviceRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
    >
      <Checkbox checked={selected} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{device.serial_number}</span>
          <span className="text-xs text-muted-foreground">({device._id})</span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {device.location?.building_id} • Floor {device.location?.floor} •{' '}
          {device.location?.room_name}
        </div>
      </div>
      <span className="text-xs capitalize px-2 py-0.5 rounded-full bg-muted">
        {device.type.replace('_', ' ')}
      </span>
    </button>
  );
}

export default ScheduleServiceModal;
