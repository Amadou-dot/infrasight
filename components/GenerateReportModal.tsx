'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { v2Api } from '@/lib/api/v2-client';
import { useMetadata } from '@/lib/query/hooks';
import { toast } from 'react-toastify';
import { FileText, Download, Loader2 } from 'lucide-react';

interface GenerateReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GenerateReportModal({ isOpen, onClose }: GenerateReportModalProps) {
  const [scope, setScope] = useState<'all' | 'building'>('all');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Fetch metadata for building dropdown
  const { data: metadata } = useMetadata();
  const buildings = metadata?.buildings || [];

  const handleGenerate = async () => {
    try {
      setIsGenerating(true);

      const query =
        scope === 'all' ? { scope } : { scope, building_id: selectedBuildingId };

      const blob = await v2Api.reports.generateDeviceHealth(query);

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `infrasight-report-${scope === 'building' ? `${selectedBuildingId}-` : ''}${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Report generated successfully!');
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate report';
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = scope === 'all' || (scope === 'building' && selectedBuildingId);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-md p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-cyan-500" />
            Generate Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Scope Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Report Scope</label>
            <Select
              value={scope}
              onValueChange={val => {
                setScope(val as 'all' | 'building');
                if (val === 'all') {
                  setSelectedBuildingId('');
                }
              }}
              options={[
                { value: 'all', label: 'All Buildings' },
                { value: 'building', label: 'Specific Building' },
              ]}
            />
          </div>

          {/* Building Selection (only shown when scope is 'building') */}
          {scope === 'building' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Select Building</label>
              <Select
                value={selectedBuildingId}
                onValueChange={setSelectedBuildingId}
                options={[
                  { value: '', label: 'Select a building...' },
                  ...buildings.map(b => ({
                    value: b.building,
                    label: `${b.building} (${b.device_count} devices)`,
                  })),
                ]}
              />
            </div>
          )}

          {/* Info text */}
          <p className="text-sm text-muted-foreground">
            The report will include aggregate device health statistics by status
            {scope === 'building' ? ' and floor' : ''}. No device identifiers will be included.
          </p>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-500/50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download PDF
                </>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
