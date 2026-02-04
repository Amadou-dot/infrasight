/**
 * V2 Device Health Report API Route
 *
 * GET /api/v2/reports/device-health - Generate PDF report with device health summary
 *
 * Features:
 * - Admin-only access
 * - Aggregate device counts by status, building, and floor
 * - PDF generation with pdf-lib
 * - No device identifiers in output (aggregate counts only)
 */

import type { NextRequest } from 'next/server';
import dbConnect from '@/lib/db';
import DeviceV2 from '@/models/v2/DeviceV2';
import { withErrorHandler, ApiError, ErrorCodes } from '@/lib/errors';
import { validateQuery } from '@/lib/validations/validator';
import { reportGenerateQuerySchema } from '@/lib/validations/v2/report.validation';
import { requireAdmin } from '@/lib/auth';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ============================================================================
// TYPES
// ============================================================================

interface StatusSummary {
  total: number;
  active: number;
  maintenance: number;
  offline: number;
  error: number;
  decommissioned: number;
}

interface FloorBreakdown {
  floor: number;
  summary: StatusSummary;
}

interface BuildingBreakdown {
  building_id: string;
  summary: StatusSummary;
  floors: FloorBreakdown[];
}

interface ReportData {
  generated_at: string;
  scope: 'all' | 'building';
  building_id?: string;
  summary: StatusSummary;
  breakdowns: BuildingBreakdown[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createEmptySummary(): StatusSummary {
  return {
    total: 0,
    active: 0,
    maintenance: 0,
    offline: 0,
    error: 0,
    decommissioned: 0,
  };
}

function addToSummary(summary: StatusSummary, status: string, count: number): void {
  summary.total += count;
  switch (status) {
    case 'active':
      summary.active += count;
      break;
    case 'maintenance':
      summary.maintenance += count;
      break;
    case 'offline':
      summary.offline += count;
      break;
    case 'error':
      summary.error += count;
      break;
    case 'decommissioned':
      summary.decommissioned += count;
      break;
  }
}

async function aggregateDeviceData(
  scope: 'all' | 'building',
  buildingId?: string
): Promise<ReportData> {
  // Build match conditions for active devices
  const activeMatch: Record<string, unknown> = {
    'audit.deleted_at': { $exists: false },
  };

  if (scope === 'building' && buildingId) {
    activeMatch['location.building_id'] = buildingId;
  }

  // Aggregate active devices by building, floor, and status
  const activeAggregation = await DeviceV2.aggregate([
    { $match: activeMatch },
    {
      $group: {
        _id: {
          building_id: '$location.building_id',
          floor: '$location.floor',
          status: '$status',
        },
        count: { $sum: 1 },
      },
    },
  ]).option({ maxTimeMS: 10000 });

  // Count decommissioned/deleted devices separately
  // These are devices where status === 'decommissioned' OR audit.deleted_at exists
  const deletedMatch: Record<string, unknown> = {
    $or: [{ status: 'decommissioned' }, { 'audit.deleted_at': { $exists: true } }],
  };

  if (scope === 'building' && buildingId) {
    deletedMatch['location.building_id'] = buildingId;
  }

  const deletedAggregation = await DeviceV2.aggregate([
    { $match: deletedMatch },
    {
      $group: {
        _id: {
          building_id: '$location.building_id',
          floor: '$location.floor',
        },
        count: { $sum: 1 },
      },
    },
  ]).option({ maxTimeMS: 10000 });

  // Build the report data structure
  const buildingMap = new Map<
    string,
    {
      summary: StatusSummary;
      floors: Map<number, StatusSummary>;
    }
  >();

  const globalSummary = createEmptySummary();

  // Process active device aggregation
  for (const item of activeAggregation) {
    const { building_id, floor, status } = item._id;
    const count = item.count;

    // Update global summary
    addToSummary(globalSummary, status, count);

    // Get or create building entry
    if (!buildingMap.has(building_id)) {
      buildingMap.set(building_id, {
        summary: createEmptySummary(),
        floors: new Map(),
      });
    }
    const building = buildingMap.get(building_id)!;

    // Update building summary
    addToSummary(building.summary, status, count);

    // Get or create floor entry
    if (!building.floors.has(floor)) {
      building.floors.set(floor, createEmptySummary());
    }
    const floorSummary = building.floors.get(floor)!;

    // Update floor summary
    addToSummary(floorSummary, status, count);
  }

  // Process deleted/decommissioned device aggregation
  for (const item of deletedAggregation) {
    const { building_id, floor } = item._id;
    const count = item.count;

    // Update global decommissioned count
    globalSummary.decommissioned += count;
    globalSummary.total += count;

    // Get or create building entry
    if (!buildingMap.has(building_id)) {
      buildingMap.set(building_id, {
        summary: createEmptySummary(),
        floors: new Map(),
      });
    }
    const building = buildingMap.get(building_id)!;

    // Update building decommissioned count
    building.summary.decommissioned += count;
    building.summary.total += count;

    // Get or create floor entry (only for building scope)
    if (scope === 'building') {
      if (!building.floors.has(floor)) {
        building.floors.set(floor, createEmptySummary());
      }
      const floorSummary = building.floors.get(floor)!;
      floorSummary.decommissioned += count;
      floorSummary.total += count;
    }
  }

  // Convert to final structure
  const breakdowns: BuildingBreakdown[] = [];

  for (const [building_id, data] of buildingMap) {
    const floors: FloorBreakdown[] = [];

    // Only include per-floor breakdown for building scope
    if (scope === 'building') {
      for (const [floor, summary] of data.floors) {
        floors.push({ floor, summary });
      }
      // Sort floors by floor number
      floors.sort((a, b) => a.floor - b.floor);
    }

    breakdowns.push({
      building_id,
      summary: data.summary,
      floors,
    });
  }

  // Sort buildings by building_id
  breakdowns.sort((a, b) => a.building_id.localeCompare(b.building_id));

  return {
    generated_at: new Date().toISOString(),
    scope,
    building_id: buildingId,
    summary: globalSummary,
    breakdowns,
  };
}

async function generatePdf(data: ReportData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612; // Letter size
  const pageHeight = 792;
  const margin = 50;
  const lineHeight = 18;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let yPosition = pageHeight - margin;

  const drawText = (
    text: string,
    x: number,
    y: number,
    size: number,
    isBold = false,
    color = rgb(0, 0, 0)
  ) => {
    page.drawText(text, {
      x,
      y,
      size,
      font: isBold ? boldFont : font,
      color,
    });
  };

  const addNewPageIfNeeded = (requiredSpace: number) => {
    if (yPosition - requiredSpace < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      yPosition = pageHeight - margin;
    }
  };

  // Title
  drawText('Infrasight Device Health Report', margin, yPosition, 20, true);
  yPosition -= 30;

  // Subtitle with scope and date
  const scopeDescription =
    data.scope === 'all' ? 'All Buildings' : `Building: ${data.building_id}`;
  const generatedDate = new Date(data.generated_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  drawText(`${scopeDescription} • Generated: ${generatedDate}`, margin, yPosition, 10);
  yPosition -= 40;

  // Summary Section
  drawText('Summary', margin, yPosition, 14, true);
  yPosition -= 25;

  // Draw summary table
  const summaryRows = [
    ['Status', 'Count'],
    ['Total Devices', data.summary.total.toString()],
    ['Active', data.summary.active.toString()],
    ['Maintenance', data.summary.maintenance.toString()],
    ['Offline', data.summary.offline.toString()],
    ['Error', data.summary.error.toString()],
    ['Decommissioned', data.summary.decommissioned.toString()],
  ];

  for (let i = 0; i < summaryRows.length; i++) {
    const [label, value] = summaryRows[i];
    const isHeader = i === 0;
    drawText(label, margin, yPosition, 10, isHeader);
    drawText(value, margin + 150, yPosition, 10, isHeader);
    yPosition -= lineHeight;
  }

  yPosition -= 20;

  // Building/Floor Breakdowns
  if (data.breakdowns.length > 0) {
    addNewPageIfNeeded(50);

    if (data.scope === 'all') {
      drawText('Per-Building Breakdown', margin, yPosition, 14, true);
    } else {
      drawText('Per-Floor Breakdown', margin, yPosition, 14, true);
    }
    yPosition -= 25;

    for (const building of data.breakdowns) {
      addNewPageIfNeeded(120);

      // Building header
      drawText(`Building: ${building.building_id}`, margin, yPosition, 12, true, rgb(0.2, 0.2, 0.6));
      yPosition -= 20;

      // Building summary
      const buildingSummaryText = `Total: ${building.summary.total} | Active: ${building.summary.active} | Maintenance: ${building.summary.maintenance} | Offline: ${building.summary.offline} | Error: ${building.summary.error} | Decommissioned: ${building.summary.decommissioned}`;
      drawText(buildingSummaryText, margin + 10, yPosition, 9);
      yPosition -= 20;

      // Floor breakdowns (only for building scope)
      if (data.scope === 'building' && building.floors.length > 0) {
        for (const floor of building.floors) {
          addNewPageIfNeeded(40);

          drawText(`Floor ${floor.floor}:`, margin + 20, yPosition, 10, true);
          yPosition -= lineHeight;

          const floorSummaryText = `Active: ${floor.summary.active} | Maintenance: ${floor.summary.maintenance} | Offline: ${floor.summary.offline} | Error: ${floor.summary.error} | Decommissioned: ${floor.summary.decommissioned}`;
          drawText(floorSummaryText, margin + 30, yPosition, 9);
          yPosition -= lineHeight;
        }
      }

      yPosition -= 15;
    }
  }

  // Footer
  addNewPageIfNeeded(40);
  yPosition = margin + 20;
  drawText(
    'This report contains aggregate device counts only. No device identifiers are included.',
    margin,
    yPosition,
    8,
    false,
    rgb(0.5, 0.5, 0.5)
  );

  return pdfDoc.save();
}

// ============================================================================
// GET /api/v2/reports/device-health - Generate Device Health PDF Report
// ============================================================================

export async function GET(request: NextRequest) {
  return withErrorHandler(async () => {
    // Admin-only endpoint
    await requireAdmin();

    await dbConnect();

    const searchParams = request.nextUrl.searchParams;

    // Validate query parameters
    const validationResult = validateQuery(searchParams, reportGenerateQuerySchema);
    if (!validationResult.success) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationResult.errors.map(e => e.message).join(', '),
        { errors: validationResult.errors }
      );
    }

    const { scope, building_id } = validationResult.data;

    // Aggregate device data
    const reportData = await aggregateDeviceData(scope, building_id);

    // Generate PDF
    const pdfBytes = await generatePdf(reportData);

    // Format filename with date
    const dateStr = new Date().toISOString().split('T')[0];
    const scopeSuffix = scope === 'building' ? `${building_id}-` : '';
    const filename = `infrasight-report-${scopeSuffix}${dateStr}.pdf`;

    // Return PDF response (convert Uint8Array to Buffer for Response compatibility)
    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  })();
}
