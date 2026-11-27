import { getOffsetPaginationParams, calculateOffsetPagination } from '@/lib/api/pagination';
import { CACHE_TTL, devicesListKey } from '@/lib/cache';
import {
  type ReadContext,
  fieldProjection,
  readCachedSnapshot,
  readOptions,
} from '@/lib/data/read-context';
import { sanitizeSearchQuery } from '@/lib/validations/sanitizer';
import type { ListDevicesQuery, GetDeviceQuery } from '@/lib/validations/v2/device.validation';
import DeviceV2 from '@/models/v2/DeviceV2';
import ReadingV2 from '@/models/v2/ReadingV2';

export function readDevices(context: ReadContext, query: ListDevicesQuery) {
  return readCachedSnapshot(
    devicesListKey(context, query),
    CACHE_TTL.DEVICES_LIST,
    context,
    async () => {
      const options = readOptions(context);
      // Extract pagination
      const pagination = getOffsetPaginationParams({
        page: query.page,
        limit: query.limit,
      });

      // Build filter query
      const filter: Record<string, unknown> = {};

      // Status filter
      if (query.status) {
        const statuses = Array.isArray(query.status) ? query.status : [query.status];
        filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
      }

      // Type filter
      if (query.type) {
        const types = Array.isArray(query.type) ? query.type : [query.type];
        filter.type = types.length === 1 ? types[0] : { $in: types };
      }

      // Location filters
      if (query.building_id) filter['location.building_id'] = query.building_id;

      if (query.floor !== undefined) filter['location.floor'] = query.floor;

      if (query.zone) filter['location.zone'] = query.zone;

      // Metadata filters
      if (query.department) filter['metadata.department'] = query.department;

      if (query.manufacturer) filter.manufacturer = query.manufacturer;

      if (query.tags) {
        const tags = Array.isArray(query.tags) ? query.tags : [query.tags];
        filter['metadata.tags'] = { $in: tags };
      }

      // Health filters
      if (query.min_battery !== undefined)
        filter['health.battery_level'] = {
          ...((filter['health.battery_level'] as Record<string, number>) || {}),
          $gte: query.min_battery,
        };

      if (query.max_battery !== undefined)
        filter['health.battery_level'] = {
          ...((filter['health.battery_level'] as Record<string, number>) || {}),
          $lte: query.max_battery,
        };

      // Soft delete filter
      if (query.only_deleted) filter['audit.deleted_at'] = { $exists: true };
      else if (!query.include_deleted) filter['audit.deleted_at'] = { $exists: false };

      // Date range filter
      if (query.startDate || query.endDate) {
        const dateField = query.date_filter_field
          ? query.date_filter_field === 'last_seen'
            ? 'health.last_seen'
            : `audit.${query.date_filter_field}`
          : 'audit.created_at';

        filter[dateField] = {};
        if (query.startDate)
          (filter[dateField] as Record<string, Date>).$gte = new Date(query.startDate);

        if (query.endDate)
          (filter[dateField] as Record<string, Date>).$lte = new Date(query.endDate);
      }

      // Search filter
      if (query.search) {
        const searchRegex = sanitizeSearchQuery(query.search);
        filter.$or = [
          { serial_number: { $regex: searchRegex, $options: 'i' } },
          { 'location.room_name': { $regex: searchRegex, $options: 'i' } },
          { 'metadata.tags': { $regex: searchRegex, $options: 'i' } },
        ];
      }

      // Build sort
      const sortOrder = query.sortDirection === 'desc' ? -1 : 1;
      const sortField = query.sortBy || 'created_at';
      const sort: Record<string, 1 | -1> = {};

      // Map sort field to actual path
      const sortFieldMap: Record<string, string> = {
        created_at: 'audit.created_at',
        updated_at: 'audit.updated_at',
        last_seen: 'health.last_seen',
        serial_number: 'serial_number',
        status: 'status',
        floor: 'location.floor',
        building_id: 'location.building_id',
        manufacturer: 'manufacturer',
        uptime_percentage: 'health.uptime_percentage',
        battery_level: 'health.battery_level',
      };

      sort[sortFieldMap[sortField] || sortField] = sortOrder;

      // Execute query
      const [devices, total] = await Promise.all([
        DeviceV2.find(filter, fieldProjection(query.fields))
          .sort(sort)
          .skip(pagination.skip)
          .limit(pagination.limit)
          .setOptions(options)
          .lean(),
        DeviceV2.countDocuments(filter).setOptions(options),
      ]);

      // Calculate pagination info
      const paginationInfo = calculateOffsetPagination(total, pagination.page, pagination.limit);

      return { devices, paginationInfo };
    }
  );
}

/** Every lookup for the device itself applies the active predicate before projection. */
export async function readDevice(context: ReadContext, id: string, query: GetDeviceQuery) {
  const options = readOptions(context);
  const activeDevice = { _id: id, 'audit.deleted_at': { $exists: false } };
  let recentReadings;
  if (query.include_recent_readings) {
    if (!(await DeviceV2.exists(activeDevice).setOptions(options))) return null;
    recentReadings = await ReadingV2.find({ 'metadata.device_id': id })
      .sort({ timestamp: -1 })
      .limit(query.readings_limit || 10)
      .setOptions(options)
      .lean();
  }

  const device = await DeviceV2.findOne(
    activeDevice,
    fieldProjection(query.fields),
    options
  ).lean();
  if (!device || !recentReadings) return device;
  return { ...device, recent_readings: recentReadings };
}
