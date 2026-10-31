import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  test.describe(`Floor Plan at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('renders partial readings and switches building without stale tiles', async ({
      page,
    }, testInfo) => {
      const devices = Array.from({ length: 107 }, (_, index) => ({
        _id: `device_${String(index).padStart(3, '0')}`,
        type: 'temperature',
        location: { building_id: 'Building-A', floor: 0, room_name: `Room ${index}` },
        configuration: { threshold_warning: 100, threshold_critical: 120 },
      }));
      devices.push({
        _id: 'device_b001',
        type: 'temperature',
        location: { building_id: 'Building-B', floor: 0, room_name: 'Building B room' },
        configuration: { threshold_warning: 100, threshold_critical: 120 },
      });
      let releaseLastBatch!: () => void;
      const lastBatch = new Promise<void>(resolve => {
        releaseLastBatch = resolve;
      });
      const deviceRequests: URL[] = [];
      const readingRequests: string[][] = [];

      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/v2/metadata')
          await route.fulfill({
            json: {
              success: true,
              data: {
                buildings: [
                  { building: 'Building-A', device_count: 107, floors: [{ floor: 0 }] },
                  { building: 'Building-B', device_count: 1, floors: [{ floor: 0 }] },
                ],
              },
            },
          });
        else if (url.pathname === '/api/v2/devices') {
          deviceRequests.push(url);
          const filtered = devices.filter(
            device =>
              !url.searchParams.has('building_id') ||
              device.location.building_id === url.searchParams.get('building_id')
          );
          const pageNumber = Number(url.searchParams.get('page') || 1);
          await route.fulfill({
            json: {
              success: true,
              data: filtered.slice((pageNumber - 1) * 100, pageNumber * 100),
              pagination: {
                total: filtered.length,
                totalPages: Math.ceil(filtered.length / 100),
                page: pageNumber,
                limit: 100,
              },
            },
          });
        } else if (url.pathname === '/api/v2/readings/latest') {
          const ids = url.searchParams.getAll('device_ids');
          readingRequests.push(ids);
          if (ids.includes('device_106')) await lastBatch;
          await route.fulfill({
            json: {
              success: true,
              data: {
                readings: ids.map(id => ({
                  device_id: id,
                  type: 'temperature',
                  value: id === 'device_b001' ? 40 : 20 + Number(id.slice(7)) / 100,
                  timestamp: '2026-10-31T10:00:00Z',
                })),
              },
            },
          });
        } else await route.fulfill({ json: { success: true, data: [], pagination: { total: 0 } } });
      });

      try {
        await page.goto('/floor-plan');
        await expect(page.getByText('20°F', { exact: true })).toBeVisible();
        await expect(page.getByText('Updating readings…')).toBeVisible();
        await expect(page.getByText('21.06°F', { exact: true })).toHaveCount(0);
        expect(
          deviceRequests.every(url => url.searchParams.get('building_id') === 'Building-A')
        ).toBe(true);
        expect(
          deviceRequests.every(url => url.searchParams.get('fields')?.includes('location.floor'))
        ).toBe(true);
        expect(readingRequests).toHaveLength(3);
        expect(readingRequests.flat()).toHaveLength(107);
        await page.screenshot({
          path: testInfo.outputPath('partial-readings.png'),
          fullPage: true,
        });

        releaseLastBatch();
        await expect(page.getByText('Updating readings…')).toHaveCount(0);
        await expect(page.getByText('21.06°F', { exact: true })).toBeAttached();
        await page.getByRole('button', { name: /Building:/ }).click();
        await page.getByRole('option', { name: 'Building-B (1)', exact: true }).click();
        await expect(page.getByText('40°F', { exact: true })).toBeVisible();
        await expect(page.getByText('Room 0', { exact: true })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('building-b.png'), fullPage: true });

        await page.getByRole('button', { name: /Building:/ }).click();
        await page.getByRole('option', { name: 'All Buildings', exact: true }).click();
        await expect(page.getByText('20°F', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /Building:/ })).toContainText(
          'All Buildings'
        );
        expect(deviceRequests.some(url => !url.searchParams.has('building_id'))).toBe(true);
      } finally {
        releaseLastBatch();
      }
    });
  });
