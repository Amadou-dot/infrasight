'use client';

import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ============================================================================
// TYPES
// ============================================================================

export interface DeviceSearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedFloor: number | 'all';
  onFloorChange: (floor: number | 'all') => void;
  floors: number[];
  activeFilterCount: number;
  onOpenFilterModal: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function DeviceSearchBar({
  searchQuery,
  onSearchChange,
  selectedFloor,
  onFloorChange,
  floors,
  activeFilterCount,
  onOpenFilterModal,
}: DeviceSearchBarProps) {
  return (
    <section className='mb-6'>
      <div className='flex flex-col lg:flex-row gap-4'>
        {/* Search Input */}
        <div className='relative flex-1'>
          <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground' />
          <input
            type='text'
            placeholder='Search by Name, IP, or MAC Address'
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className='w-full pl-10 pr-4 py-2 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'
          />
        </div>

        {/* Floor Filters */}
        <div className='flex items-center gap-2 flex-wrap'>
          <Button
            variant={selectedFloor === 'all' ? 'default' : 'outline'}
            size='sm'
            onClick={() => onFloorChange('all')}>
            All Floors
          </Button>
          {floors.map(floor => (
            <Button
              key={floor}
              variant={selectedFloor === floor ? 'default' : 'outline'}
              size='sm'
              onClick={() => onFloorChange(floor)}>
              Floor {floor}
            </Button>
          ))}
        </div>

        {/* Filter Button */}
        <div className='flex items-center gap-2'>
          <Button 
            variant='outline' 
            size='sm'
            onClick={onOpenFilterModal}
            className={activeFilterCount > 0 ? 'border-primary' : ''}
          >
            <SlidersHorizontal className='h-4 w-4 mr-2' />
            Filter
            {activeFilterCount > 0 && (
              <Badge variant='secondary' className='ml-2 h-5 w-5 p-0 flex items-center justify-center text-xs'>
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
