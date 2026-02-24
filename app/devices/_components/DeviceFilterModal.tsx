'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEVICE_STATUSES = [
  'active',
  'maintenance',
  'offline',
  'decommissioned',
  'error',
] as const;

export const DEVICE_TYPES = [
  'temperature',
  'humidity',
  'occupancy',
  'power',
  'co2',
  'pressure',
  'light',
  'motion',
  'air_quality',
  'water_flow',
  'gas',
  'vibration',
  'voltage',
  'current',
  'energy',
] as const;

// ============================================================================
// TYPES
// ============================================================================

export interface DeviceFilters {
  status: string[];
  type: string[];
  manufacturer: string[];
  department: string[];
}

export const INITIAL_FILTERS: DeviceFilters = {
  status: [],
  type: [],
  manufacturer: [],
  department: [],
};

export interface FilterOptions {
  manufacturers: string[];
  departments: string[];
}

export interface DeviceFilterModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  pendingFilters: DeviceFilters;
  filterOptions: FilterOptions;
  onToggleFilterValue: (category: keyof DeviceFilters, value: string) => void;
  onClearAll: () => void;
  onApply: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function DeviceFilterModal({
  isOpen,
  onOpenChange,
  pendingFilters,
  filterOptions,
  onToggleFilterValue,
  onClearAll,
  onApply,
}: DeviceFilterModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" />
            Filter Devices
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Status Filter */}
          <div>
            <h4 className="text-sm font-medium mb-3">Status</h4>
            <div className="flex flex-wrap gap-2">
              {DEVICE_STATUSES.map(status => (
                <Button
                  key={status}
                  variant={pendingFilters.status.includes(status) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onToggleFilterValue('status', status)}
                  className="capitalize"
                >
                  {status}
                  {pendingFilters.status.includes(status) && <X className="h-3 w-3 ml-1" />}
                </Button>
              ))}
            </div>
          </div>

          {/* Device Type Filter */}
          <div>
            <h4 className="text-sm font-medium mb-3">Device Type</h4>
            <div className="flex flex-wrap gap-2">
              {DEVICE_TYPES.map(type => (
                <Button
                  key={type}
                  variant={pendingFilters.type.includes(type) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onToggleFilterValue('type', type)}
                  className="capitalize"
                >
                  {type.replaceAll('_', ' ')}
                  {pendingFilters.type.includes(type) && <X className="h-3 w-3 ml-1" />}
                </Button>
              ))}
            </div>
          </div>

          {/* Manufacturer Filter */}
          {filterOptions.manufacturers.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-3">Manufacturer</h4>
              <div className="flex flex-wrap gap-2">
                {filterOptions.manufacturers.map(manufacturer => (
                  <Button
                    key={manufacturer}
                    variant={
                      pendingFilters.manufacturer.includes(manufacturer) ? 'default' : 'outline'
                    }
                    size="sm"
                    onClick={() => onToggleFilterValue('manufacturer', manufacturer)}
                  >
                    {manufacturer}
                    {pendingFilters.manufacturer.includes(manufacturer) && (
                      <X className="h-3 w-3 ml-1" />
                    )}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Department Filter */}
          {filterOptions.departments.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-3">Department</h4>
              <div className="flex flex-wrap gap-2">
                {filterOptions.departments.map(department => (
                  <Button
                    key={department}
                    variant={pendingFilters.department.includes(department) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onToggleFilterValue('department', department)}
                    className="capitalize"
                  >
                    {department}
                    {pendingFilters.department.includes(department) && (
                      <X className="h-3 w-3 ml-1" />
                    )}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="ghost" onClick={onClearAll} className="mr-auto">
            Clear All
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onApply}>Apply Filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
