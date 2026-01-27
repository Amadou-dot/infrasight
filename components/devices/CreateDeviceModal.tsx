'use client';

import * as React from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { TagInput } from './TagInput';
import { cn } from '@/lib/utils';
import { v2Api, ApiClientError } from '@/lib/api/v2-client';
import { createDeviceSchema } from '@/lib/validations/v2/device.validation';
import type { DeviceV2Response, DeviceType, DataClassification } from '@/types/v2';

// ============================================================================
// TYPES
// ============================================================================

interface CreateDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (device: DeviceV2Response) => void;
}

interface FormErrors {
  [key: string]: string | undefined;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEVICE_TYPES: { value: DeviceType; label: string }[] = [
  { value: 'temperature', label: 'Temperature' },
  { value: 'humidity', label: 'Humidity' },
  { value: 'occupancy', label: 'Occupancy' },
  { value: 'power', label: 'Power' },
  { value: 'co2', label: 'CO2' },
  { value: 'pressure', label: 'Pressure' },
  { value: 'light', label: 'Light' },
  { value: 'motion', label: 'Motion' },
  { value: 'air_quality', label: 'Air Quality' },
  { value: 'water_flow', label: 'Water Flow' },
  { value: 'gas', label: 'Gas' },
  { value: 'vibration', label: 'Vibration' },
  { value: 'voltage', label: 'Voltage' },
  { value: 'current', label: 'Current' },
  { value: 'energy', label: 'Energy' },
];

const DATA_CLASSIFICATIONS: { value: DataClassification; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'internal', label: 'Internal' },
  { value: 'confidential', label: 'Confidential' },
  { value: 'restricted', label: 'Restricted' },
];

const INITIAL_FORM_DATA = {
  _id: '',
  serial_number: '',
  manufacturer: '',
  device_model: '',
  firmware_version: '',
  type: 'temperature' as DeviceType,
  configuration: {
    threshold_warning: 0,
    threshold_critical: 0,
    sampling_interval: 60,
    calibration_offset: 0,
  },
  location: {
    building_id: '',
    floor: 1,
    room_name: '',
    zone: '',
  },
  metadata: {
    tags: [] as string[],
    department: 'unknown',
    cost_center: '',
  },
  compliance: {
    requires_encryption: false,
    data_classification: 'internal' as DataClassification,
    retention_days: 90,
  },
};

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface FormSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function FormSection({ title, defaultOpen = true, children }: FormSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5 text-left text-sm font-medium hover:bg-muted transition-colors"
        >
          {title}
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 pb-1">
        <div className="space-y-4 px-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

function FormField({ label, error, required, children }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function CreateDeviceModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateDeviceModalProps) {
  const [formData, setFormData] = React.useState(INITIAL_FORM_DATA);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [generalError, setGeneralError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Reset form when modal opens/closes
  React.useEffect(() => {
    if (!isOpen) {
      setFormData(INITIAL_FORM_DATA);
      setErrors({});
      setGeneralError(null);
    }
  }, [isOpen]);

  // Form update helpers
  const updateField = <K extends keyof typeof formData>(
    key: K,
    value: typeof formData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const updateNestedField = <
    K extends 'configuration' | 'location' | 'metadata' | 'compliance'
  >(
    parent: K,
    key: keyof typeof formData[K],
    value: unknown
  ) => {
    setFormData((prev) => ({
      ...prev,
      [parent]: { ...prev[parent], [key]: value },
    }));
    const errorKey = `${parent}.${String(key)}`;
    if (errors[errorKey]) {
      setErrors((prev) => ({ ...prev, [errorKey]: undefined }));
    }
  };

  // Validation
  const validateForm = (): boolean => {
    const result = createDeviceSchema.safeParse(formData);

    if (!result.success) {
      const newErrors: FormErrors = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        newErrors[path] = issue.message;
      }
      setErrors(newErrors);
      return false;
    }

    setErrors({});
    return true;
  };

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const response = await v2Api.devices.create(formData);
      toast.success('Device created successfully');
      onSuccess(response.data);
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError) {
        // Handle specific error codes
        switch (err.errorCode) {
          case 'SERIAL_NUMBER_EXISTS':
            setErrors({ serial_number: 'Serial number already exists' });
            break;
          case 'DEVICE_ID_EXISTS':
            setErrors({ _id: 'Device ID already exists' });
            break;
          case 'VALIDATION_ERROR':
            if (err.details?.errors) {
              const newErrors: FormErrors = {};
              for (const error of err.details.errors as { path: string[]; message: string }[]) {
                const path = Array.isArray(error.path) ? error.path.join('.') : String(error.path);
                newErrors[path] = error.message;
              }
              setErrors(newErrors);
            } else {
              setGeneralError(err.message);
            }
            break;
          case 'RATE_LIMIT_EXCEEDED':
            setGeneralError('Too many requests. Please try again later.');
            break;
          case 'UNAUTHORIZED':
            setGeneralError('You are not authorized to create devices. Please sign in.');
            break;
          default:
            setGeneralError(err.message || 'An error occurred. Please try again.');
        }
      } else {
        setGeneralError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Device</DialogTitle>
          <DialogDescription>
            Create a new IoT device. Fill in the required fields and configure
            optional settings as needed.
          </DialogDescription>
        </DialogHeader>

        {generalError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Information - Always visible */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">
              Basic Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Device ID" error={errors._id} required>
                <Input
                  value={formData._id}
                  onChange={(e) => updateField('_id', e.target.value)}
                  placeholder="e.g., device_001"
                  error={!!errors._id}
                />
              </FormField>
              <FormField
                label="Serial Number"
                error={errors.serial_number}
                required
              >
                <Input
                  value={formData.serial_number}
                  onChange={(e) => updateField('serial_number', e.target.value)}
                  placeholder="e.g., SN-12345"
                  error={!!errors.serial_number}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Manufacturer"
                error={errors.manufacturer}
                required
              >
                <Input
                  value={formData.manufacturer}
                  onChange={(e) => updateField('manufacturer', e.target.value)}
                  placeholder="e.g., Acme Corp"
                  error={!!errors.manufacturer}
                />
              </FormField>
              <FormField
                label="Device Model"
                error={errors.device_model}
                required
              >
                <Input
                  value={formData.device_model}
                  onChange={(e) => updateField('device_model', e.target.value)}
                  placeholder="e.g., TempSensor Pro"
                  error={!!errors.device_model}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Firmware Version"
                error={errors.firmware_version}
                required
              >
                <Input
                  value={formData.firmware_version}
                  onChange={(e) =>
                    updateField('firmware_version', e.target.value)
                  }
                  placeholder="e.g., 1.0.0"
                  error={!!errors.firmware_version}
                />
              </FormField>
              <FormField label="Device Type" error={errors.type} required>
                <Select
                  value={formData.type}
                  onValueChange={(value) => updateField('type', value as DeviceType)}
                  options={DEVICE_TYPES}
                  placeholder="Select type"
                />
              </FormField>
            </div>
          </div>

          {/* Location Section */}
          <FormSection title="Location" defaultOpen>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Building ID"
                error={errors['location.building_id']}
                required
              >
                <Input
                  value={formData.location.building_id}
                  onChange={(e) =>
                    updateNestedField('location', 'building_id', e.target.value)
                  }
                  placeholder="e.g., BLDG-A"
                  error={!!errors['location.building_id']}
                />
              </FormField>
              <FormField
                label="Floor"
                error={errors['location.floor']}
                required
              >
                <Input
                  type="number"
                  value={formData.location.floor}
                  onChange={(e) =>
                    updateNestedField(
                      'location',
                      'floor',
                      parseInt(e.target.value) || 0
                    )
                  }
                  min={-10}
                  max={200}
                  error={!!errors['location.floor']}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Room Name"
                error={errors['location.room_name']}
                required
              >
                <Input
                  value={formData.location.room_name}
                  onChange={(e) =>
                    updateNestedField('location', 'room_name', e.target.value)
                  }
                  placeholder="e.g., Server Room A"
                  error={!!errors['location.room_name']}
                />
              </FormField>
              <FormField label="Zone" error={errors['location.zone']}>
                <Input
                  value={formData.location.zone}
                  onChange={(e) =>
                    updateNestedField('location', 'zone', e.target.value)
                  }
                  placeholder="e.g., North Wing"
                />
              </FormField>
            </div>
          </FormSection>

          {/* Configuration Section */}
          <FormSection title="Configuration" defaultOpen>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Warning Threshold"
                error={errors['configuration.threshold_warning']}
                required
              >
                <Input
                  type="number"
                  value={formData.configuration.threshold_warning}
                  onChange={(e) =>
                    updateNestedField(
                      'configuration',
                      'threshold_warning',
                      parseFloat(e.target.value) || 0
                    )
                  }
                  step="0.1"
                  error={!!errors['configuration.threshold_warning']}
                />
              </FormField>
              <FormField
                label="Critical Threshold"
                error={errors['configuration.threshold_critical']}
                required
              >
                <Input
                  type="number"
                  value={formData.configuration.threshold_critical}
                  onChange={(e) =>
                    updateNestedField(
                      'configuration',
                      'threshold_critical',
                      parseFloat(e.target.value) || 0
                    )
                  }
                  step="0.1"
                  error={!!errors['configuration.threshold_critical']}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Sampling Interval (seconds)"
                error={errors['configuration.sampling_interval']}
              >
                <Input
                  type="number"
                  value={formData.configuration.sampling_interval}
                  onChange={(e) =>
                    updateNestedField(
                      'configuration',
                      'sampling_interval',
                      parseInt(e.target.value) || 60
                    )
                  }
                  min={1}
                />
              </FormField>
              <FormField
                label="Calibration Offset"
                error={errors['configuration.calibration_offset']}
              >
                <Input
                  type="number"
                  value={formData.configuration.calibration_offset}
                  onChange={(e) =>
                    updateNestedField(
                      'configuration',
                      'calibration_offset',
                      parseFloat(e.target.value) || 0
                    )
                  }
                  step="0.01"
                />
              </FormField>
            </div>
          </FormSection>

          {/* Metadata Section */}
          <FormSection title="Metadata" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Department"
                error={errors['metadata.department']}
              >
                <Input
                  value={formData.metadata.department}
                  onChange={(e) =>
                    updateNestedField('metadata', 'department', e.target.value)
                  }
                  placeholder="e.g., Facilities"
                />
              </FormField>
              <FormField
                label="Cost Center"
                error={errors['metadata.cost_center']}
              >
                <Input
                  value={formData.metadata.cost_center}
                  onChange={(e) =>
                    updateNestedField('metadata', 'cost_center', e.target.value)
                  }
                  placeholder="e.g., CC-001"
                />
              </FormField>
            </div>
            <FormField label="Tags" error={errors['metadata.tags']}>
              <TagInput
                value={formData.metadata.tags}
                onChange={(tags) =>
                  updateNestedField('metadata', 'tags', tags)
                }
                placeholder="Add tag and press Enter"
              />
            </FormField>
          </FormSection>

          {/* Compliance Section */}
          <FormSection title="Compliance" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Data Classification"
                error={errors['compliance.data_classification']}
              >
                <Select
                  value={formData.compliance.data_classification}
                  onValueChange={(value) =>
                    updateNestedField(
                      'compliance',
                      'data_classification',
                      value as DataClassification
                    )
                  }
                  options={DATA_CLASSIFICATIONS}
                />
              </FormField>
              <FormField
                label="Retention Days"
                error={errors['compliance.retention_days']}
              >
                <Input
                  type="number"
                  value={formData.compliance.retention_days}
                  onChange={(e) =>
                    updateNestedField(
                      'compliance',
                      'retention_days',
                      parseInt(e.target.value) || 90
                    )
                  }
                  min={1}
                />
              </FormField>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="requires_encryption"
                checked={formData.compliance.requires_encryption}
                onCheckedChange={(checked) =>
                  updateNestedField(
                    'compliance',
                    'requires_encryption',
                    checked === true
                  )
                }
              />
              <Label htmlFor="requires_encryption" className="text-sm cursor-pointer">
                Requires Encryption
              </Label>
            </div>
          </FormSection>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Device'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
