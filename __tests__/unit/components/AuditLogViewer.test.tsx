/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AuditLogViewer from '@/components/AuditLogViewer';

const twoEntries = [
  { timestamp: '2026-07-30T10:00:00.000Z', action: 'update', user: 'admin@example.com' },
  { timestamp: '2026-07-29T09:00:00.000Z', action: 'create', user: 'admin@example.com' },
];

describe('AuditLogViewer', () => {
  it('labels the All filter with the server total when provided', () => {
    render(
      <AuditLogViewer deviceId="device_001" entries={twoEntries} loading={false} total={57} />
    );
    expect(screen.getByText('All (57)')).toBeInTheDocument();
  });

  it('falls back to the loaded count without a total', () => {
    render(<AuditLogViewer deviceId="device_001" entries={twoEntries} loading={false} />);
    expect(screen.getByText('All (2)')).toBeInTheDocument();
  });
});
