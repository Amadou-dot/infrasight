'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DeviceDetailView from '@/components/devices/DeviceDetailView';
import { useDeviceDetail } from '@/components/devices/useDeviceDetail';

interface DeviceDetailModalProps {
  deviceId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Quick inspection of a device from a grid or panel. The same content is available
 * at the canonical `/devices/[id]` route, which this modal links out to.
 */
export default function DeviceDetailModal({ deviceId, isOpen, onClose }: DeviceDetailModalProps) {
  const { device, recentReadings, auditLog, loading, error, notFound } = useDeviceDetail(
    deviceId,
    isOpen
  );

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">Device Details</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          </div>
        )}

        {notFound && !loading && (
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-muted-foreground">Device {deviceId} could not be found.</p>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {device && !loading && (
          <DeviceDetailView
            device={device}
            recentReadings={recentReadings}
            auditLog={auditLog}
            headerAction={
              <Link
                href={`/devices/${device._id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Open full page
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
