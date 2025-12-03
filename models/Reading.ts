import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReading extends Document {
  metadata: {
    device_id: string;
    type: 'temperature' | 'humidity' | 'occupancy' | 'power';
  };
  timestamp: Date;
  value: number;
}

const ReadingSchema: Schema = new Schema(
  {
    metadata: {
      device_id: { type: String, required: true },
      type: { type: String, required: true },
    },
    timestamp: { type: Date, required: true },
    value: { type: Number, required: true },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'seconds',
    },
    expireAfterSeconds: 604800, // 7 days
  }
);

// Prevent recompilation of model in development
const Reading: Model<IReading> = mongoose.models.Reading || mongoose.model<IReading>('Reading', ReadingSchema);

export default Reading;
