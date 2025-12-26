'use client';

import { useEffect, useState } from 'react';
import { v2Api } from '@/lib/api/v2-client';
import type { DeviceV2Response } from '@/types/v2';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import AuditLogViewer from './AuditLogViewer';
import TemperatureCorrelationPanel from './TemperatureCorrelationPanel';
import {
  MapPin,
  Cpu,
  Battery,
  Signal,
  Calendar,
  Tag,
  AlertTriangle,
  CheckCircle,
  Clock,
  Wrench,
  History,
  Info,
  Settings,
  TrendingUp,
  Lock,
  Shield,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DeviceDetailModalProps {
  deviceId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'overview' | 'readings' | 'config' | 'audit';

export default function DeviceDetailModal({
  deviceId,
  isOpen,
  onClose,
}: DeviceDetailModalProps) {
  const [device, setDevice] = useState<DeviceV2Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [recentReadings, setRecentReadings] = useState<any[]>([]);

  useEffect(() => {
    if (!deviceId || !isOpen) {
      setDevice(null);
      setError(null);
      setActiveTab('overview');
      return;
    }

    const fetchDeviceData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch device details
        const deviceResponse = await v2Api.devices.getById(deviceId);
        setDevice(deviceResponse.data);

        // Fetch recent readings
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const readingsResponse = await v2Api.readings.list({
          device_id: deviceId,
          start_date: oneDayAgo.toISOString(),
          end_date: now.toISOString(),
          limit: 100,
        });
        
        if (readingsResponse.success && readingsResponse.data) 
          setRecentReadings(readingsResponse.data);
        

        // Fetch audit log
        try {
          const auditResponse = await v2Api.devices.getHistory(deviceId);
          if (auditResponse.success && auditResponse.data) 
            setAuditLog(Array.isArray(auditResponse.data) ? auditResponse.data : []);
          
        } catch (err) {
          console.warn('Audit log not available:', err);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load device details'
        );
        console.error('Error fetching device data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDeviceData();
  }, [deviceId, isOpen]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'maintenance':
        return <Wrench className="h-4 w-4 text-yellow-500" />;
      case 'offline':
        return <Clock className="h-4 w-4 text-gray-500" />;
      case 'error':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500">Active</Badge>;
      case 'maintenance':
        return <Badge className="bg-yellow-500">Maintenance</Badge>;
      case 'offline':
        return <Badge variant="secondary">Offline</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'decommissioned':
        return <Badge variant="outline">Decommissioned</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatReadingsForChart = () => {
    if (!recentReadings || recentReadings.length === 0) return [];
    
    return recentReadings.map((reading: any) => ({
      time: new Date(reading.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      value: reading.value,
    })).reverse();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            Device Details
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {device && !loading && (
          <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="space-y-2 min-w-0">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white break-all">
                  {device._id}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusIcon(device.status)}
                  {getStatusBadge(device.status)}
                  <Badge variant="outline">{device.type}</Badge>
                </div>
              </div>
              <div className="text-left sm:text-right text-sm text-gray-600 dark:text-gray-400 shrink-0">
                <p className="break-all">Serial: {device.serial_number}</p>
                <p>Last seen: {formatDate(device.health?.last_seen)}</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 sm:gap-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'overview'
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <Info className="h-3 w-3 sm:h-4 sm:w-4 inline mr-1" />
                Overview
              </button>
              <button
                onClick={() => setActiveTab('readings')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'readings'
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 inline mr-1" />
                Readings
              </button>
              <button
                onClick={() => setActiveTab('config')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'config'
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <Settings className="h-3 w-3 sm:h-4 sm:w-4 inline mr-1" />
                Config
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'audit'
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <History className="h-3 w-3 sm:h-4 sm:w-4 inline mr-1" />
                Audit
              </button>
            </div>

            {/* Tab Content */}
            <div className="min-h-[300px]">
              {activeTab === 'overview' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Device Information */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      Device Information
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Manufacturer:</span>
                        <span className="font-medium">{device.manufacturer}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Model:</span>
                        <span className="font-medium">{device.device_model}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Firmware:</span>
                        <span className="font-medium">{device.firmware_version}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Department:</span>
                        <span className="font-medium">{device.metadata?.department}</span>
                      </div>
                    </div>
                  </div>

                  {/* Location */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Location
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Building:</span>
                        <span className="font-medium">{device.location?.building_id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Floor:</span>
                        <span className="font-medium">{device.location?.floor}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Room:</span>
                        <span className="font-medium">{device.location?.room_name}</span>
                      </div>
                      {device.location?.zone && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Zone:</span>
                          <span className="font-medium">{device.location.zone}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Health Metrics */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <Signal className="h-4 w-4" />
                      Health Metrics
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Uptime:</span>
                        <span className="font-medium">
                          {device.health?.uptime_percentage?.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Error Count:</span>
                        <span className="font-medium">{device.health?.error_count || 0}</span>
                      </div>
                      {device.health?.battery_level !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Battery:</span>
                          <span className="font-medium flex items-center gap-1">
                            <Battery className="h-4 w-4" />
                            {device.health.battery_level}%
                          </span>
                        </div>
                      )}
                      {device.health?.signal_strength !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Signal:</span>
                          <span className="font-medium">{device.health.signal_strength}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Maintenance */}
                  {(device.metadata?.last_maintenance || device.metadata?.next_maintenance) && (
                    <div className="space-y-4">
                      <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Maintenance
                      </h3>
                      <div className="space-y-2 text-sm">
                        {device.metadata.last_maintenance && (
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Last:</span>
                            <span className="font-medium">
                              {formatDate(device.metadata.last_maintenance)}
                            </span>
                          </div>
                        )}
                        {device.metadata.next_maintenance && (
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Next:</span>
                            <span className="font-medium">
                              {formatDate(device.metadata.next_maintenance)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {device.metadata?.tags && device.metadata.tags.length > 0 && (
                    <div className="space-y-4 md:col-span-2">
                      <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Tag className="h-4 w-4" />
                        Tags
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {device.metadata.tags.map((tag, index) => (
                          <Badge key={index} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Security & Compliance */}
                  {device.compliance && (
                    <div className="space-y-4 md:col-span-2">
                      <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Security & Compliance
                      </h3>
                      
                      {/* Data Classification Badge */}
                      <div className={`
                        rounded-lg p-4 border-2
                        ${device.compliance.data_classification === 'restricted' 
                          ? 'bg-linear-to-r from-purple-50 to-amber-50 dark:from-purple-900/20 dark:to-amber-900/20 border-purple-500'
                          : device.compliance.data_classification === 'confidential'
                          ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-500'
                          : device.compliance.data_classification === 'internal'
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
                          : 'bg-green-50 dark:bg-green-900/20 border-green-500'
                        }
                      `}>
                        <div className="flex items-start gap-3">
                          {device.compliance.requires_encryption ? (
                            <Lock className={`h-5 w-5 mt-0.5 ${
                              device.compliance.data_classification === 'restricted'
                                ? 'text-purple-600 dark:text-purple-400'
                                : device.compliance.data_classification === 'confidential'
                                ? 'text-orange-600 dark:text-orange-400'
                                : device.compliance.data_classification === 'internal'
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-green-600 dark:text-green-400'
                            }`} />
                          ) : (
                            <Shield className={`h-5 w-5 mt-0.5 ${
                              device.compliance.data_classification === 'restricted'
                                ? 'text-purple-600 dark:text-purple-400'
                                : device.compliance.data_classification === 'confidential'
                                ? 'text-orange-600 dark:text-orange-400'
                                : device.compliance.data_classification === 'internal'
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-green-600 dark:text-green-400'
                            }`} />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className={`
                                ${device.compliance.data_classification === 'restricted'
                                  ? 'bg-purple-600 hover:bg-purple-700'
                                  : device.compliance.data_classification === 'confidential'
                                  ? 'bg-orange-600 hover:bg-orange-700'
                                  : device.compliance.data_classification === 'internal'
                                  ? 'bg-blue-600 hover:bg-blue-700'
                                  : 'bg-green-600 hover:bg-green-700'
                                }
                              `}>
                                {device.compliance.data_classification.toUpperCase()}
                              </Badge>
                              {device.compliance.requires_encryption && (
                                <Badge variant="outline" className="flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  Encrypted
                                </Badge>
                              )}
                            </div>
                            <div className="space-y-1 text-sm">
                              <p className={`font-medium ${
                                device.compliance.data_classification === 'restricted'
                                  ? 'text-purple-900 dark:text-purple-200'
                                  : device.compliance.data_classification === 'confidential'
                                  ? 'text-orange-900 dark:text-orange-200'
                                  : device.compliance.data_classification === 'internal'
                                  ? 'text-blue-900 dark:text-blue-200'
                                  : 'text-green-900 dark:text-green-200'
                              }`}>
                                {device.compliance.data_classification === 'restricted' 
                                  ? 'Highly Sensitive Data - Maximum Security Required'
                                  : device.compliance.data_classification === 'confidential'
                                  ? 'Confidential Data - Restricted Access'
                                  : device.compliance.data_classification === 'internal'
                                  ? 'Internal Use Only - Standard Security'
                                  : 'Public Data - No Restrictions'
                                }
                              </p>
                              {device.compliance.requires_encryption && (
                                <p className="text-muted-foreground">
                                  All data from this device is encrypted at rest and in transit
                                </p>
                              )}
                              <p className="text-muted-foreground">
                                Data retention: {device.compliance.retention_days} days
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'readings' && (
                <div className="space-y-6">
                  {/* Temperature Correlation Panel for temperature devices */}
                  {device.type === 'temperature' && (
                    <TemperatureCorrelationPanel deviceId={device._id} />
                  )}
                  
                  {/* Standard Readings Chart */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      Recent Readings (Last 24 Hours)
                    </h3>
                  {recentReadings.length === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                      No recent readings available
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={formatReadingsForChart()}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="time"
                          tick={{ fontSize: 12 }}
                          stroke="#888"
                        />
                        <YAxis tick={{ fontSize: 12 }} stroke="#888" />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={{ r: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                  </div>
                </div>
              )}

              {activeTab === 'config' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    Device Configuration
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Warning Threshold:</span>
                        <span className="font-medium">{device.configuration?.threshold_warning}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Critical Threshold:</span>
                        <span className="font-medium">{device.configuration?.threshold_critical}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Sampling Interval:</span>
                        <span className="font-medium">{device.configuration?.sampling_interval}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Calibration Offset:</span>
                        <span className="font-medium">{device.configuration?.calibration_offset}</span>
                      </div>
                      {device.configuration?.calibration_date && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">Last Calibration:</span>
                          <span className="font-medium">
                            {formatDate(device.configuration.calibration_date)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'audit' && (
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                    Audit Trail
                  </h3>
                  <AuditLogViewer
                    deviceId={device._id}
                    entries={auditLog}
                    loading={false}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
