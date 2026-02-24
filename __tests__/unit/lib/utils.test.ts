/**
 * Utils Tests
 *
 * Tests for the cn() utility function that merges Tailwind CSS classes.
 */

import { cn } from '@/lib/utils';

describe('cn (class name utility)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('merges simple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('returns empty string for no arguments', () => {
    expect(cn()).toBe('');
  });

  it('handles undefined and null values', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });

  it('handles boolean conditionals', () => {
    expect(cn('base', false && 'hidden', true && 'visible')).toBe('base visible');
  });

  it('handles empty strings', () => {
    expect(cn('foo', '', 'bar')).toBe('foo bar');
  });

  it('merges conflicting Tailwind classes (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('merges conflicting Tailwind text color classes', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('merges conflicting Tailwind background classes', () => {
    expect(cn('bg-red-100', 'bg-blue-200')).toBe('bg-blue-200');
  });

  it('handles array input', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });

  it('handles object input with truthy/falsy values', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('handles mixed input types', () => {
    expect(cn('base', ['arr1', 'arr2'], { conditional: true })).toBe('base arr1 arr2 conditional');
  });

  it('does not deduplicate non-Tailwind class names', () => {
    // twMerge only deduplicates conflicting Tailwind utilities, not arbitrary classes
    expect(cn('foo', 'foo')).toBe('foo foo');
  });

  it('handles Tailwind responsive prefix merging', () => {
    expect(cn('md:p-4', 'md:p-2')).toBe('md:p-2');
  });
});
