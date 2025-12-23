/**
 * V2 API Client
 *
 * Type-safe API client for consuming v2 endpoints with
 * error handling, retry logic, and proper TypeScript types.
 */

import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  PaginatedResponse,
  DeviceV2Response,
  DeviceListResponse,
  DeviceHistoryResponse,
  ListDevicesQuery,
  ReadingV2Response,
  ReadingListResponse,
  LatestReadingsResponse,
  ListReadingsQuery,
  LatestReadingsQuery,
  MaintenanceForecastQuery,
  MaintenanceForecastResponse,
  TemperatureCorrelationQuery,
  TemperatureCorrelationResponse,
} from '@/types/v2';

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class ApiClientError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Build query string from params object
 */
function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      value.forEach((v) => searchParams.append(key, String(v)));
    } else {
      searchParams.append(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

/**
 * Sleep utility for retry logic
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // If successful or non-retryable error, return
      if (
        response.ok ||
        !config.retryableStatuses.includes(response.status)
      ) {
        return response;
      }

      // If retryable error and not last attempt, retry
      if (attempt < config.maxRetries) {
        await sleep(config.retryDelay * (attempt + 1)); // Exponential backoff
        continue;
      }

      return response;
    } catch (error) {
      lastError = error as Error;

      // If not last attempt, retry
      if (attempt < config.maxRetries) {
        await sleep(config.retryDelay * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Generic API call handler
 */
async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  try {
    const response = retry
      ? await fetchWithRetry(endpoint, options)
      : await fetch(endpoint, options);

    const data = await response.json();

    if (!response.ok) {
      const errorData = data as ApiErrorResponse;
      throw new ApiClientError(
        response.status,
        errorData.error?.code || 'UNKNOWN_ERROR',
        errorData.error?.message || 'An error occurred',
        errorData.error?.details
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }

    throw new ApiClientError(
      500,
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Network error occurred'
    );
  }
}

// ============================================================================
// DEVICE API
// ============================================================================

export const deviceApi = {
  /**
   * List devices with optional filters
   */
  async list(
    query: ListDevicesQuery = {}
  ): Promise<PaginatedResponse<DeviceV2Response>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/devices${queryString}`);
  },

  /**
   * Get a single device by ID
   */
  async getById(id: string): Promise<ApiSuccessResponse<DeviceV2Response>> {
    return apiCall(`/api/v2/devices/${id}`);
  },

  /**
   * Get device history/audit log
   */
  async getHistory(
    id: string,
    query: { startDate?: string; endDate?: string; actionType?: string } = {}
  ): Promise<ApiSuccessResponse<DeviceHistoryResponse>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/devices/${id}/history${queryString}`);
  },

  /**
   * Update a device
   */
  async update(
    id: string,
    data: Partial<DeviceV2Response>
  ): Promise<ApiSuccessResponse<DeviceV2Response>> {
    return apiCall(`/api/v2/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  /**
   * Soft delete a device
   */
  async delete(id: string): Promise<ApiSuccessResponse<{ success: boolean }>> {
    return apiCall(`/api/v2/devices/${id}`, {
      method: 'DELETE',
    });
  },
};

// ============================================================================
// READINGS API
// ============================================================================

export const readingsApi = {
  /**
   * List readings with filters
   */
  async list(
    query: ListReadingsQuery = {}
  ): Promise<PaginatedResponse<ReadingV2Response>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/readings${queryString}`);
  },

  /**
   * Get latest readings
   */
  async latest(
    query: LatestReadingsQuery = {}
  ): Promise<ApiSuccessResponse<LatestReadingsResponse>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/readings/latest${queryString}`);
  },
};

// ============================================================================
// ANALYTICS API
// ============================================================================

export interface EnergyAnalyticsQuery {
  period?: string;
  floor?: number;
  granularity?: 'minute' | 'hour' | 'day';
  aggregationType?: 'sum' | 'avg' | 'min' | 'max';
  deviceType?: string;
  includeInvalid?: boolean;
  groupBy?: 'floor' | 'room' | 'type' | 'department';
}

export interface EnergyDataPoint {
  timestamp: string;
  value: number;
  quality?: {
    validReadings: number;
    totalReadings: number;
    percentageValid: number;
  };
}

export interface HealthMetrics {
  summary: {
    total_devices: number;
    active_devices: number;
    health_score: number;
    uptime_stats: {
      _id: null;
      avg_uptime: number;
      min_uptime: number;
      max_uptime: number;
      total_errors: number;
    };
  };
  status_breakdown: Array<{
    status: string;
    count: number;
  }>;
  alerts: {
    offline_devices: {
      count: number;
      threshold_minutes: number;
      devices: Array<{
        _id: string;
        serial_number: string;
        location: {
          building_id: string;
          floor: number;
          room_name: string;
        };
        health: {
          last_seen: string;
        };
        status: string;
      }>;
    };
    low_battery_devices: {
      count: number;
      threshold_percent: number;
      devices: Array<{
        _id: string;
        serial_number: string;
        location: {
          room_name: string;
        };
        health: {
          battery_level: number;
        };
      }>;
    };
    error_devices: {
      count: number;
      devices: Array<{
        _id: string;
        serial_number: string;
        location: {
          room_name: string;
        };
        status: string;
      }>;
    };
    maintenance_due: {
      count: number;
      devices: Array<{
        _id: string;
        serial_number: string;
        location: {
          room_name: string;
        };
        metadata: {
          next_maintenance: string;
        };
      }>;
    };
  };
  filters_applied: {
    building_id: string | null;
    floor: number | null;
    department: string | null;
  };
}

export interface AnomalyData {
  _id: string;
  timestamp: string;
  value: number;
  metadata: {
    device_id: string;
    source: string;
    type: string;
    unit: string;
  };
  quality: {
    is_valid: boolean;
    confidence_score?: number;
    validation_flags?: string[];
    is_anomaly: boolean;
    anomaly_score?: number;
  };
  processing?: {
    raw_value?: number;
    calibration_offset?: number;
    ingested_at?: string;
  };
  context?: {
    battery_level?: number;
    signal_strength?: number;
  };
}

export interface AnomalyResponse {
  anomalies: AnomalyData[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  summary: {
    total_anomalies: number;
    by_device: Array<{
      device_id: string;
      count: number;
      latest_timestamp: string;
      avg_score: number;
    }>;
    by_type: Array<{
      type: string;
      count: number;
      avg_score: number;
    }>;
  };
  trends: any;
  filters_applied: {
    device_id: string | null;
    type: string | null;
    time_range: Record<string, any>;
  };
}

export const analyticsApi = {
  /**
   * Get energy analytics
   */
  async energy(
    query: EnergyAnalyticsQuery = {}
  ): Promise<ApiSuccessResponse<EnergyDataPoint[]>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/analytics/energy${queryString}`);
  },

  /**
   * Get device health metrics
   */
  async health(): Promise<ApiSuccessResponse<HealthMetrics>> {
    return apiCall('/api/v2/analytics/health');
  },

  /**
   * Get anomaly data
   */
  async anomalies(query: {
    deviceId?: string;
    startTime?: string;
    endTime?: string;
    minScore?: number;
    limit?: number;
  } = {}): Promise<ApiSuccessResponse<AnomalyResponse>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/analytics/anomalies${queryString}`);
  },

  /**
   * Get maintenance forecast
   */
  async maintenanceForecast(
    query: MaintenanceForecastQuery = {}
  ): Promise<ApiSuccessResponse<MaintenanceForecastResponse>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/analytics/maintenance-forecast${queryString}`);
  },

  /**
   * Get temperature correlation analysis
   */
  async temperatureCorrelation(
    query: TemperatureCorrelationQuery
  ): Promise<ApiSuccessResponse<TemperatureCorrelationResponse>> {
    const queryString = buildQueryString(query as unknown as Record<string, unknown>);
    return apiCall(`/api/v2/analytics/temperature-correlation${queryString}`);
  },
};

// ============================================================================
// METADATA API
// ============================================================================

export interface MetadataResponse {
  manufacturers: string[];
  models: string[];
  departments: string[];
  tags: string[];
  buildings: string[];
  floors: number[];
  rooms: string[];
  deviceTypes: Array<{
    type: string;
    count: number;
    activeCount: number;
  }>;
  healthStats: {
    online: number;
    maintenance: number;
    offline: number;
    decommissioned: number;
  };
}

export const metadataApi = {
  /**
   * Get aggregated metadata
   */
  async get(): Promise<ApiSuccessResponse<MetadataResponse>> {
    return apiCall('/api/v2/metadata');
  },
};

// ============================================================================
// AUDIT API
// ============================================================================

export interface AuditLogEntry {
  device_id: string;
  action: string;
  timestamp: string;
  user: string;
  changes?: Record<string, unknown>;
}

export const auditApi = {
  /**
   * Query audit logs
   */
  async list(query: {
    userId?: string;
    actionType?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<PaginatedResponse<AuditLogEntry>> {
    const queryString = buildQueryString(query as Record<string, unknown>);
    return apiCall(`/api/v2/audit${queryString}`);
  },
};

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Main v2 API client
 */
export const v2Api = {
  devices: deviceApi,
  readings: readingsApi,
  analytics: analyticsApi,
  metadata: metadataApi,
  audit: auditApi,
};

export default v2Api;
