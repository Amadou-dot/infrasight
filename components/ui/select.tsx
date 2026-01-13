'use client';

import * as React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

// ============================================================================
// Select Component
// ============================================================================

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  label,
  disabled = false,
  className,
  size = 'sm',
}: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  // Close on outside click
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node))
        setOpen(false);
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  // Close on Escape
  React.useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [open]);

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
  };

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex items-center justify-between gap-2 rounded-md border transition-colors',
          'bg-white dark:bg-zinc-900',
          'border-gray-200 dark:border-zinc-700',
          'text-gray-900 dark:text-gray-100',
          'hover:border-gray-300 dark:hover:border-zinc-600',
          'focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          sizeClasses[size],
          'min-w-30'
        )}
      >
        <span className="flex items-center gap-2">
          {label && <span className="text-gray-500 dark:text-gray-400 font-medium">{label}:</span>}
          <span className={cn(!selectedOption && 'text-gray-400 dark:text-gray-500')}>
            {selectedOption?.label || placeholder}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute z-50 mt-1 w-full min-w-40 overflow-hidden rounded-md border shadow-lg',
            'bg-white dark:bg-zinc-900',
            'border-gray-200 dark:border-zinc-700',
            'animate-in fade-in-0 zoom-in-95'
          )}
        >
          <div className="max-h-60 overflow-auto py-1">
            {options.map(option => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2 text-sm transition-colors',
                    'text-gray-700 dark:text-gray-200',
                    'hover:bg-gray-100 dark:hover:bg-zinc-800',
                    isSelected && 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                    option.disabled && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <span>{option.label}</span>
                  {isSelected && <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Convenience wrapper for labeled selects (common pattern)
// ============================================================================

export interface LabeledSelectProps extends Omit<SelectProps, 'label'> {
  label: string;
}

export function LabeledSelect({ label, className, ...props }: LabeledSelectProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 bg-white dark:bg-zinc-900 p-2 rounded-lg border border-gray-200 dark:border-zinc-700 shadow-sm',
        className
      )}
    >
      <span className="text-sm font-medium text-gray-600 dark:text-gray-200 px-2">{label}:</span>
      <Select {...props} />
    </div>
  );
}

export default Select;
