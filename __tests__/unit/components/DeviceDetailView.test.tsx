/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DeviceV2Response, ReadingV2Response } from '@/types/v2';
import DeviceDetailView from '@/components/devices/DeviceDetailView';

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="readings-chart">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

jest.mock('@/components/AuditLogViewer', () => {
  const AuditLogViewer = ({ entries }: { entries: Array<{ action: string }> }) => (
    <div data-testid="audit-log">{entries.length} entries</div>
  );
  AuditLogViewer.displayName = 'AuditLogViewer';
  return AuditLogViewer;
});

jest.mock('@/components/TemperatureCorrelationPanel', () => {
  const TemperatureCorrelationPanel = ({ deviceId }: { deviceId: string }) => (
    <div data-testid="temperature-correlation">{deviceId}</div>
  );
  TemperatureCorrelationPanel.displayName = 'TemperatureCorrelationPanel';
  return TemperatureCorrelationPanel;
});

function createDevice(overrides: Partial<DeviceV2Response> = {}): DeviceV2Response {
  return {
    _id: 'device_001',
    serial_number: 'SN-12345',
    manufacturer: 'Acme Sensors',
    device_model: 'TX-100',
    firmware_version: '2.1.0',
    type: 'temperature',
    status: 'active',
    configuration: {
      threshold_warning: 28,
      threshold_critical: 35,
      sampling_interval: 60,
      calibration_offset: 0.5,
    },
    location: {
      building_id: 'building_a',
      floor: 3,
      room_name: 'Server Room',
      zone: 'north',
    },
    metadata: {
      department: 'Facilities',
      tags: ['critical', 'hvac'],
    },
    audit: {},
    health: {
      uptime_percentage: 99.25,
      error_count: 2,
      battery_level: 44,
      last_seen: '2026-07-30T12:00:00.000Z',
    },
    compliance: {
      data_classification: 'internal',
      requires_encryption: true,
      retention_days: 90,
    },
    ...overrides,
  } as DeviceV2Response;
}

const readings = [
  {
    timestamp: '2026-07-30T11:00:00.000Z',
    value: 21.5,
    metadata: { device_id: 'device_001', type: 'temperature', unit: 'celsius' },
  },
] as unknown as ReadingV2Response[];

describe('DeviceDetailView', () => {
  it('should show the device identity in the header', () => {
    render(<DeviceDetailView device={createDevice()} recentReadings={[]} auditLog={[]} />);

    expect(screen.getByRole('heading', { name: 'device_001' })).toBeInTheDocument();
    expect(screen.getByText(/SN-12345/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should render a caller-supplied header action', () => {
    render(
      <DeviceDetailView
        device={createDevice()}
        recentReadings={[]}
        auditLog={[]}
        headerAction={<span data-testid="header-action">Open full page</span>}
      />
    );

    expect(screen.getByTestId('header-action')).toHaveTextContent('Open full page');
  });

  it('should open on the overview tab', () => {
    render(<DeviceDetailView device={createDevice()} recentReadings={[]} auditLog={[]} />);

    expect(screen.getByText('Acme Sensors')).toBeInTheDocument();
    expect(screen.getByText('Server Room')).toBeInTheDocument();
    expect(screen.getByText('99.3%')).toBeInTheDocument();
  });

  it('should chart recent readings on the readings tab', () => {
    render(<DeviceDetailView device={createDevice()} recentReadings={readings} auditLog={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /readings/i }));

    expect(screen.getByTestId('readings-chart')).toBeInTheDocument();
    expect(screen.getByTestId('temperature-correlation')).toHaveTextContent('device_001');
  });

  it('should say so when there are no readings to chart', () => {
    render(<DeviceDetailView device={createDevice()} recentReadings={[]} auditLog={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /readings/i }));

    expect(screen.getByText('No recent readings available')).toBeInTheDocument();
  });

  it('should only show temperature correlation for temperature devices', () => {
    render(
      <DeviceDetailView
        device={createDevice({ type: 'humidity' })}
        recentReadings={readings}
        auditLog={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /readings/i }));

    expect(screen.queryByTestId('temperature-correlation')).not.toBeInTheDocument();
  });

  it('should show thresholds on the config tab', () => {
    render(<DeviceDetailView device={createDevice()} recentReadings={[]} auditLog={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /config/i }));

    expect(screen.getByText('Warning Threshold:')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('60s')).toBeInTheDocument();
  });

  it('should hand audit entries to the audit log on the audit tab', () => {
    render(
      <DeviceDetailView
        device={createDevice()}
        recentReadings={[]}
        auditLog={[
          { timestamp: '2026-07-30T10:00:00.000Z', action: 'update', user: 'admin@example.com' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /audit/i }));

    expect(screen.getByTestId('audit-log')).toHaveTextContent('1 entries');
  });
});
