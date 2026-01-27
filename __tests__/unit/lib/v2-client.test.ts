/**
 * V2 API Client Unit Tests
 *
 * Unit tests for the v2-client module covering device create and delete operations.
 */

import { ApiClientError, deviceApi } from '@/lib/api/v2-client';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('V2 API Client', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('ApiClientError', () => {
    it('should create an error with all properties', () => {
      const error = new ApiClientError(400, 'VALIDATION_ERROR', 'Invalid input', { field: 'name' });

      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('VALIDATION_ERROR');
      expect(error.message).toBe('Invalid input');
      expect(error.details).toEqual({ field: 'name' });
      expect(error.name).toBe('ApiClientError');
    });

    it('should extend Error class', () => {
      const error = new ApiClientError(500, 'SERVER_ERROR', 'Something went wrong');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiClientError);
    });
  });

  describe('deviceApi.create', () => {
    it('should create a device successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          _id: 'device_001',
          serial_number: 'SN-001',
          status: 'active',
        },
        message: 'Device created successfully',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const deviceData = {
        _id: 'device_001',
        serial_number: 'SN-001',
        manufacturer: 'Test Mfr',
        device_model: 'Model X',
        firmware_version: '1.0.0',
        type: 'temperature' as const,
        configuration: {
          threshold_warning: 25,
          threshold_critical: 30,
          sampling_interval: 60,
          calibration_offset: 0,
        },
        location: {
          building_id: 'b1',
          floor: 1,
          room_name: 'Room 101',
        },
      };

      const result = await deviceApi.create(deviceData);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v2/devices',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(deviceData),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw ApiClientError on validation error', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid device data',
          details: { errors: [{ path: ['serial_number'], message: 'Required' }] },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve(mockErrorResponse),
      });

      await expect(
        deviceApi.create({
          _id: 'device_001',
          serial_number: '',
          manufacturer: 'Test',
          device_model: 'Model',
          firmware_version: '1.0.0',
          type: 'temperature' as const,
          configuration: {
            threshold_warning: 25,
            threshold_critical: 30,
            sampling_interval: 60,
            calibration_offset: 0,
          },
          location: { building_id: 'b1', floor: 1, room_name: 'Room 1' },
        })
      ).rejects.toThrow(ApiClientError);
    });

    it('should throw ApiClientError on duplicate serial number', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'SERIAL_NUMBER_EXISTS',
          message: 'Device with serial number already exists',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve(mockErrorResponse),
      });

      const deviceData = {
        _id: 'device_002',
        serial_number: 'SN-DUPLICATE',
        manufacturer: 'Test Mfr',
        device_model: 'Model X',
        firmware_version: '1.0.0',
        type: 'temperature' as const,
        configuration: {
          threshold_warning: 25,
          threshold_critical: 30,
          sampling_interval: 60,
          calibration_offset: 0,
        },
        location: { building_id: 'b1', floor: 1, room_name: 'Room 1' },
      };

      try {
        await deviceApi.create(deviceData);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).errorCode).toBe('SERIAL_NUMBER_EXISTS');
        expect((error as ApiClientError).statusCode).toBe(409);
      }
    });

    it('should throw ApiClientError on duplicate device ID', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'DEVICE_ID_EXISTS',
          message: 'Device with ID already exists',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve(mockErrorResponse),
      });

      const deviceData = {
        _id: 'device_duplicate',
        serial_number: 'SN-NEW',
        manufacturer: 'Test Mfr',
        device_model: 'Model X',
        firmware_version: '1.0.0',
        type: 'temperature' as const,
        configuration: {
          threshold_warning: 25,
          threshold_critical: 30,
          sampling_interval: 60,
          calibration_offset: 0,
        },
        location: { building_id: 'b1', floor: 1, room_name: 'Room 1' },
      };

      try {
        await deviceApi.create(deviceData);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).errorCode).toBe('DEVICE_ID_EXISTS');
        expect((error as ApiClientError).statusCode).toBe(409);
      }
    });
  });

  describe('deviceApi.delete', () => {
    it('should delete a device successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          _id: 'device_001',
          deleted: true,
          deleted_at: '2024-01-15T10:00:00.000Z',
        },
        message: 'Device deleted successfully',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await deviceApi.delete('device_001');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v2/devices/device_001',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw ApiClientError on not found', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve(mockErrorResponse),
      });

      try {
        await deviceApi.delete('nonexistent_device');
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).statusCode).toBe(404);
        expect((error as ApiClientError).errorCode).toBe('NOT_FOUND');
      }
    });

    it('should throw ApiClientError when device is already deleted', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Device is already deleted',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        json: () => Promise.resolve(mockErrorResponse),
      });

      try {
        await deviceApi.delete('deleted_device');
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).statusCode).toBe(410);
      }
    });
  });

  describe('deviceApi.list', () => {
    it('should list devices with query parameters', async () => {
      const mockResponse = {
        success: true,
        data: [
          { _id: 'device_001', status: 'active' },
          { _id: 'device_002', status: 'active' },
        ],
        pagination: { total: 2, page: 1, limit: 20 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await deviceApi.list({ status: 'active', floor: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/devices?'),
        expect.any(Object)
      );
      expect(result).toEqual(mockResponse);
    });

    it('should list devices without query parameters', async () => {
      const mockResponse = {
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: 20 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await deviceApi.list();

      expect(mockFetch).toHaveBeenCalledWith('/api/v2/devices', expect.any(Object));
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deviceApi.update', () => {
    it('should update a device successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          _id: 'device_001',
          status: 'maintenance',
        },
        message: 'Device updated successfully',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await deviceApi.update('device_001', { status: 'maintenance' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v2/devices/device_001',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'maintenance' }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw ApiClientError on validation error', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid status value',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve(mockErrorResponse),
      });

      try {
        await deviceApi.update('device_001', { status: 'invalid' as never });
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).statusCode).toBe(400);
      }
    });
  });

  describe('deviceApi.getById', () => {
    it('should get a device by ID', async () => {
      const mockResponse = {
        success: true,
        data: {
          _id: 'device_001',
          serial_number: 'SN-001',
          status: 'active',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await deviceApi.getById('device_001');

      expect(mockFetch).toHaveBeenCalledWith('/api/v2/devices/device_001', expect.any(Object));
      expect(result).toEqual(mockResponse);
    });

    it('should throw ApiClientError on not found', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve(mockErrorResponse),
      });

      try {
        await deviceApi.getById('nonexistent');
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).statusCode).toBe(404);
      }
    });
  });

  describe('Network Errors', () => {
    it('should throw ApiClientError on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      try {
        await deviceApi.list();
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).statusCode).toBe(500);
        expect((error as ApiClientError).errorCode).toBe('NETWORK_ERROR');
      }
    });

    it('should handle unknown error response format', async () => {
      // Return a non-retryable status (400) to avoid retry logic
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({}),
      });

      try {
        await deviceApi.list();
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).errorCode).toBe('UNKNOWN_ERROR');
      }
    });
  });

  describe('Retry Logic', () => {
    it('should retry on server error (500)', async () => {
      // First call fails with 500, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { code: 'SERVER_ERROR', message: 'Internal error' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: [],
              pagination: { total: 0, page: 1, limit: 20 },
            }),
        });

      const result = await deviceApi.list();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('should retry on rate limit (429)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: { _id: 'test' },
            }),
        });

      const result = await deviceApi.getById('test');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });
  });
});

