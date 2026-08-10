import { render, screen } from '@testing-library/react';
import MaintenanceStatusCards from '@/components/MaintenanceStatusCards';

describe('MaintenanceStatusCards', () => {
  it('labels the due-for-service window with the fetch window it was given', () => {
    render(
      <MaintenanceStatusCards criticalCount={3} dueForServiceCount={5} healthyCount={10} daysForDue={30} />
    );
    expect(screen.getByText('Next 30 Days')).toBeInTheDocument();
  });

  it('renders no fabricated "New" badge', () => {
    render(
      <MaintenanceStatusCards criticalCount={3} dueForServiceCount={5} healthyCount={10} daysForDue={30} />
    );
    expect(screen.queryByText(/New/)).not.toBeInTheDocument();
  });
});
