'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
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
import { TagInput } from '@/components/devices/TagInput';
import { useCreateAlertRule } from '@/lib/query/hooks';
import type {
  AlertMetric,
  AlertComparison,
  AlertSeverity,
  ReadingTypeName,
  CreateAlertRuleBody,
} from '@/types/v2';

// ============================================================================
// TYPES
// ============================================================================

interface CreateAlertRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RuleFormState {
  name: string;
  description: string;
  enabled: boolean;
  metric: AlertMetric;
  comparison: AlertComparison;
  /** Kept as a string so the number input stays a normal controlled field. */
  threshold: string;
  severity: AlertSeverity;
  /** Displayed in minutes; converted to for_duration_seconds on submit. */
  durationMinutes: string;
  cooldownSeconds: string;
  types: ReadingTypeName[];
  buildingId: string;
  floor: string;
  zone: string;
  tags: string[];
}

type FormErrors = Record<string, string>;

// ============================================================================
// CONSTANTS
// ============================================================================

const METRIC_OPTIONS: { value: AlertMetric; label: string }[] = [
  { value: 'value', label: 'Value' },
  { value: 'anomaly_score', label: 'Anomaly score' },
  { value: 'battery_level', label: 'Battery level' },
];

const COMPARISON_OPTIONS: { value: AlertComparison; label: string }[] = [
  { value: 'gt', label: 'Above' },
  { value: 'gte', label: 'At or above' },
  { value: 'lt', label: 'Below' },
  { value: 'lte', label: 'At or below' },
];

const SEVERITY_OPTIONS: { value: AlertSeverity; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

/** The 15 reading types (models/v2/AlertRuleV2.ts:READING_TYPES), matching CreateDeviceModal's device-type list. */
const READING_TYPE_OPTIONS: { value: ReadingTypeName; label: string }[] = [
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

const INITIAL_FORM_STATE: RuleFormState = {
  name: '',
  description: '',
  enabled: true,
  metric: 'value',
  comparison: 'gt',
  threshold: '',
  severity: 'warning',
  durationMinutes: '0',
  cooldownSeconds: '300',
  types: [],
  buildingId: '',
  floor: '',
  zone: '',
  tags: [],
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Mirrors the server's two cross-field refinements
 * (lib/validations/v2/alert-rule.validation.ts) as a UX affordance so a user
 * is told before submitting rather than getting a 400 back. The server
 * remains the enforcement point — this is not a security boundary.
 */
function validate(form: RuleFormState): FormErrors {
  const errors: FormErrors = {};

  if (!form.name.trim()) errors.name = 'Name is required';

  const threshold = Number(form.threshold);
  if (form.threshold.trim() === '' || Number.isNaN(threshold)) 
    errors.threshold = 'Threshold is required';
   else if (form.metric === 'anomaly_score' && (threshold < 0 || threshold > 1)) 
    errors.threshold = 'Threshold must be between 0 and 1 for anomaly_score';
   else if (form.metric === 'battery_level' && (threshold < 0 || threshold > 100)) 
    errors.threshold = 'Threshold must be between 0 and 100 for battery_level';
  

  if (form.metric === 'value' && form.types.length === 0)
    errors.types = 'Select at least one reading type when the metric is a raw value';

  return errors;
}

// ============================================================================
// REQUEST BODY
// ============================================================================

/**
 * `CreateAlertRuleBody` (types/v2/alert.types.ts:121) is discriminated on
 * `metric`, and the 'value' arm requires `selector.types` to be a non-empty
 * tuple. A flat `{ ...base, metric, comparison, threshold, selector }` spread
 * from a union-typed `form.metric` does not compile — TypeScript cannot pick
 * an arm from a non-literal discriminant, and `ReadingTypeName[]` is not
 * assignable to `[ReadingTypeName, ...ReadingTypeName[]]` no matter which arm
 * is chosen. Branching on the discriminant and destructuring the array proves
 * non-emptiness to the compiler — no `as` cast, which would defeat the type
 * that exists precisely to make the invalid state unrepresentable.
 */
function buildCreateBody(form: RuleFormState): CreateAlertRuleBody | null {
  const base = {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    for_duration_seconds: Number(form.durationMinutes || 0) * 60,
    severity: form.severity,
    cooldown_seconds: Number(form.cooldownSeconds || 0),
  };

  const selector = {
    ...(form.buildingId ? { building_id: form.buildingId } : {}),
    ...(form.floor !== '' ? { floor: Number(form.floor) } : {}),
    ...(form.zone ? { zone: form.zone } : {}),
    ...(form.tags.length ? { tags: form.tags } : {}),
  };

  if (form.metric === 'value') {
    // The destructure is what proves non-emptiness to the compiler.
    // validate() has already blocked this branch, so null is unreachable.
    const [firstType, ...restTypes] = form.types;
    if (!firstType) return null;

    return {
      ...base,
      metric: 'value',
      comparison: form.comparison,
      threshold: Number(form.threshold),
      selector: { ...selector, types: [firstType, ...restTypes] },
    };
  }

  return {
    ...base,
    metric: form.metric, // narrowed to 'anomaly_score' | 'battery_level'
    comparison: form.comparison,
    threshold: Number(form.threshold),
    selector,
  };
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

/** Every input in this form gets a real `<label htmlFor>` so tests and screen readers can find it. */
function FormField({ label, htmlFor, error, required, children }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm">
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

export function CreateAlertRuleModal({ isOpen, onClose }: CreateAlertRuleModalProps) {
  const [form, setForm] = React.useState<RuleFormState>(INITIAL_FORM_STATE);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const createRule = useCreateAlertRule();

  React.useEffect(() => {
    if (!isOpen) {
      setForm(INITIAL_FORM_STATE);
      setErrors({});
    }
  }, [isOpen]);

  const update = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const toggleType = (type: ReadingTypeName, checked: boolean) => {
    setForm(prev => ({
      ...prev,
      types: checked ? [...prev.types, type] : prev.types.filter(t => t !== type),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const body = buildCreateBody(form);
    if (!body) return; // Unreachable given validate() above; satisfies the compiler only.

    createRule.mutate(body, {
      onSuccess: () => {
        toast.success('Alert rule created');
        onClose();
      },
      onError: (err: Error) => toast.error(err.message),
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Alert Rule</DialogTitle>
          <DialogDescription>
            Define a threshold condition. When it holds for the configured duration, an alert
            fires.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name" htmlFor="rule-name" error={errors.name} required>
              <Input
                id="rule-name"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                placeholder="e.g., High temperature"
                error={!!errors.name}
              />
            </FormField>
            <FormField label="Severity" htmlFor="rule-severity">
              <Select
                id="rule-severity"
                value={form.severity}
                onValueChange={value => update('severity', value as AlertSeverity)}
                options={SEVERITY_OPTIONS}
              />
            </FormField>
          </div>

          <FormField label="Description" htmlFor="rule-description">
            <Input
              id="rule-description"
              value={form.description}
              onChange={e => update('description', e.target.value)}
              placeholder="Optional notes about this rule"
            />
          </FormField>

          <div className="grid grid-cols-3 gap-4">
            <FormField label="Metric" htmlFor="rule-metric">
              <Select
                id="rule-metric"
                value={form.metric}
                onValueChange={value => update('metric', value as AlertMetric)}
                options={METRIC_OPTIONS}
              />
            </FormField>
            <FormField label="Comparison" htmlFor="rule-comparison">
              <Select
                id="rule-comparison"
                value={form.comparison}
                onValueChange={value => update('comparison', value as AlertComparison)}
                options={COMPARISON_OPTIONS}
              />
            </FormField>
            <FormField label="Threshold" htmlFor="rule-threshold" error={errors.threshold} required>
              <Input
                id="rule-threshold"
                type="number"
                step="any"
                value={form.threshold}
                onChange={e => update('threshold', e.target.value)}
                error={!!errors.threshold}
              />
            </FormField>
          </div>

          {form.metric === 'value' && (
            <div className="space-y-1.5">
              <fieldset>
                <legend className="text-sm font-medium mb-1.5">
                  Reading types
                  <span className="text-destructive ml-0.5">*</span>
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {READING_TYPE_OPTIONS.map(option => (
                    <div key={option.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`rule-type-${option.value}`}
                        checked={form.types.includes(option.value)}
                        onCheckedChange={checked => toggleType(option.value, checked === true)}
                      />
                      <Label
                        htmlFor={`rule-type-${option.value}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </fieldset>
              {errors.types && <p className="text-xs text-destructive">{errors.types}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Duration (minutes)" htmlFor="rule-duration">
              <Input
                id="rule-duration"
                type="number"
                min={0}
                value={form.durationMinutes}
                onChange={e => update('durationMinutes', e.target.value)}
              />
            </FormField>
            <FormField label="Cooldown (seconds)" htmlFor="rule-cooldown">
              <Input
                id="rule-cooldown"
                type="number"
                min={0}
                value={form.cooldownSeconds}
                onChange={e => update('cooldownSeconds', e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField label="Building ID" htmlFor="rule-building">
              <Input
                id="rule-building"
                value={form.buildingId}
                onChange={e => update('buildingId', e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Floor" htmlFor="rule-floor">
              <Input
                id="rule-floor"
                type="number"
                value={form.floor}
                onChange={e => update('floor', e.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Zone" htmlFor="rule-zone">
              <Input
                id="rule-zone"
                value={form.zone}
                onChange={e => update('zone', e.target.value)}
                placeholder="Optional"
              />
            </FormField>
          </div>

          <FormField label="Tags" htmlFor="rule-tags">
            <TagInput
              id="rule-tags"
              value={form.tags}
              onChange={tags => update('tags', tags)}
              placeholder="Add tag and press Enter"
            />
          </FormField>

          <div className="flex items-center gap-2">
            <Checkbox
              id="rule-enabled"
              checked={form.enabled}
              onCheckedChange={checked => update('enabled', checked === true)}
            />
            <Label htmlFor="rule-enabled" className="text-sm cursor-pointer">
              Enabled
            </Label>
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={createRule.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createRule.isPending}>
              {createRule.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Rule'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateAlertRuleModal;
