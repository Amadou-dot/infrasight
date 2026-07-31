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
      signal_strength: -62,
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
  describe('status', () => {
    it.each([
      ['active', 'Active'],
      ['maintenance', 'Maintenance'],
      ['offline', 'Offline'],
      ['error', 'Error'],
      ['decommissioned', 'Decommissioned'],
    ])('should badge a %s device', (status, label) => {
      render(
        <DeviceDetailView
          device={createDevice({ status: status as DeviceV2Response['status'] })}
          recentReadings={[]}
          auditLog={[]}
        />
      );

      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('should fall back to the raw value for an unrecognised status', () => {
      render(
        <DeviceDetailView
          device={createDevice({ status: 'quarantined' as DeviceV2Response['status'] })}
          recentReadings={[]}
          auditLog={[]}
        />
      );

      expect(screen.getByText('quarantined')).toBeInTheDocument();
    });
  });

  describe('compliance', () => {
    it.each([
      ['restricted', 'RESTRICTED', /Highly Sensitive Data/i],
      ['confidential', 'CONFIDENTIAL', /Confidential Data/i],
      ['internal', 'INTERNAL', /Internal Use Only/i],
      ['public', 'PUBLIC', /Public Data/i],
    ])('should describe %s data', (classification, badge, description) => {
      render(
        <DeviceDetailView
          device={createDevice({
            compliance: {
              data_classification: classification,
              requires_encryption: true,
              retention_days: 90,
            } as DeviceV2Response['compliance'],
          })}
          recentReadings={[]}
          auditLog={[]}
        />
      );

      expect(screen.getByText(badge)).toBeInTheDocument();
      expect(screen.getByText(description)).toBeInTheDocument();
      expect(screen.getByText('Encrypted')).toBeInTheDocument();
      expect(screen.getByText(/encrypted at rest and in transit/i)).toBeInTheDocument();
    });

    it.each(['restricted', 'confidential', 'internal', 'public'])(
      'should not claim encryption for an unencrypted %s device',
      classification => {
        render(
          <DeviceDetailView
            device={createDevice({
              compliance: {
                data_classification: classification,
                requires_encryption: false,
                retention_days: 30,
              } as DeviceV2Response['compliance'],
            })}
            recentReadings={[]}
            auditLog={[]}
          />
        );

        expect(screen.queryByText('Encrypted')).not.toBeInTheDocument();
        expect(screen.queryByText(/encrypted at rest and in transit/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Data retention: 30 days/i)).toBeInTheDocument();
      }
    );

    it('should omit the section entirely when there is no compliance data', () => {
      render(
        <DeviceDetailView
          device={createDevice({
            compliance: undefined as unknown as DeviceV2Response['compliance'],
          })}
          recentReadings={[]}
          auditLog={[]}
        />
      );

      expect(screen.queryByText('Security & Compliance')).not.toBeInTheDocument();
    });
  });

  describe('optional fields', () => {
    it('should render a device that reports almost nothing', () => {
      const sparse = {
        _id: 'device_099',
        serial_number: 'SN-99',
        status: 'offline',
        type: 'gas',
      } as unknown as DeviceV2Response;

      render(<DeviceDetailView device={sparse} recentReadings={[]} auditLog={[]} />);

      expect(screen.getByRole('heading', { name: 'device_099' })).toBeInTheDocument();
      expect(screen.getByText(/Last seen: N\/A/)).toBeInTheDocument();
      expect(screen.queryByText('Battery:')).not.toBeInTheDocument();
      expect(screen.queryByText('Signal:')).not.toBeInTheDocument();
      expect(screen.queryByText('Zone:')).not.toBeInTheDocument();
      expect(screen.queryByText('Tags')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /config/i }));

      expect(screen.getByText('Warning Threshold:')).toBeInTheDocument();
      expect(screen.queryByText('Last Calibration:')).not.toBeInTheDocument();
    });

    it('should surface the last error when one is recorded', () => {
      render(
        <DeviceDetailView
          device={createDevice({
            health: {
              uptime_percentage: 80,
              error_count: 5,
              last_error: {
                code: 'E_TIMEOUT',
                message: 'Sensor did not respond',
                timestamp: '2026-07-30T09:00:00.000Z',
              },
            } as unknown as DeviceV2Response['health'],
          })}
          recentReadings={[]}
          auditLog={[]}
        />
      );

      expect(screen.getByText(/E_TIMEOUT/)).toBeInTheDocument();
      expect(screen.getByText('Sensor did not respond')).toBeInTheDocument();
    });

    it('should show maintenance dates when scheduled', () => {
      render(
        <DeviceDetailView
          device={createDevice({
            metadata: {
              department: 'Facilities',
              tags: [],
              last_maintenance: '2026-06-01T00:00:00.000Z',
              next_maintenance: '2026-09-01T00:00:00.000Z',
            } as unknown as DeviceV2Response['metadata'],
          })}
          recentReadings={[]}
          auditLog={[]}
        />
      );

      expect(screen.getByText('Maintenance')).toBeInTheDocument();
      expect(screen.getByText('Last:')).toBeInTheDocument();
      expect(screen.getByText('Next:')).toBeInTheDocument();
    });

    it('should list tags when the device has them', () => {
      render(<DeviceDetailView device={createDevice()} recentReadings={[]} auditLog={[]} />);

      expect(screen.getByText('critical')).toBeInTheDocument();
      expect(screen.getByText('hvac')).toBeInTheDocument();
    });

    it('should show the calibration date on the config tab when set', () => {
      render(
        <DeviceDetailView
          device={createDevice({
            configuration: {
              threshold_warning: 28,
              threshold_critical: 35,
              sampling_interval: 60,
              calibration_offset: 0.5,
              calibration_date: '2026-05-01T00:00:00.000Z',
            } as unknown as DeviceV2Response['configuration'],
          })}
          recentReadings={[]}
          auditLog={[]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /config/i }));

      expect(screen.getByText('Last Calibration:')).toBeInTheDocument();
    });
  });

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
    expect(screen.getByText('-62')).toBeInTheDocument();
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
