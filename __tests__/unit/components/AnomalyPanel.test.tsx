/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AnomalyPanel from '@/components/AnomalyPanel';
import { v2Api } from '@/lib/api/v2-client';

jest.mock('@/lib/api/v2-client', () => ({
  v2Api: { analytics: { anomalies: jest.fn() } },
}));

it('badges the server total, not the page size', async () => {
  (v2Api.analytics.anomalies as jest.Mock).mockResolvedValue({
    success: true,
    data: {
      anomalies: Array.from({ length: 8 }, (_, i) => ({
        _id: `anomaly_${i}`,
        timestamp: new Date().toISOString(),
        value: 99,
        metadata: {
          device_id: `device_00${i}`,
          source: 'sensor',
          type: 'temperature',
          unit: 'celsius',
        },
        quality: { is_valid: true, is_anomaly: true, anomaly_score: 0.9 },
      })),
      summary: { total_anomalies: 143 },
    },
  });
  render(<AnomalyPanel maxAlerts={8} />);
  await waitFor(() => expect(screen.getByText('143')).toBeInTheDocument());
});
