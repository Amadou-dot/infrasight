import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IDevice extends Omit<Document, '_id'> {
  _id: string; // Custom ID like "device_001"
  building_id: string;
  floor: number;
  room_name: string;
  type: 'temperature' | 'humidity' | 'occupancy' | 'power';
  status: 'active' | 'maintenance' | 'offline';
  install_date: Date;
  configuration: {
    threshold_warning: number;
    threshold_critical: number;
  };
}

const DeviceSchema: Schema = new Schema({
  _id: { type: String, required: true },
  building_id: { type: String, required: true },
  floor: { type: Number, required: true },
  room_name: { type: String, required: true },
  type: {
    type: String,
    enum: ['temperature', 'humidity', 'occupancy', 'power'],
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'maintenance', 'offline'],
    default: 'active',
  },
  install_date: { type: Date, required: true },
  configuration: {
    threshold_warning: { type: Number, required: true },
    threshold_critical: { type: Number, required: true },
  },
});

// Prevent recompilation of model in development
const Device: Model<IDevice> =
  mongoose.models.Device || mongoose.model<IDevice>('Device', DeviceSchema);

export default Device;
