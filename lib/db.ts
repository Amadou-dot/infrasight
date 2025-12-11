import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) 
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env.local'
  );


/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

let cached = global.mongoose;

if (!cached) 
  cached = global.mongoose = { conn: null, promise: null };


async function dbConnect() {
  if (cached!.conn) 
    return cached!.conn;
  

  if (!cached!.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    };

    cached!.promise = mongoose.connect(MONGODB_URI!, opts).then((mongoose) => {
      // eslint-disable-next-line no-console
      console.log('MongoDB connected successfully');
      return mongoose;
    }).catch((error) => {
      console.error('MongoDB connection error:', error);
      cached!.promise = null;
      throw new Error('Failed to connect to MongoDB');
    });
  }

  try {
    cached!.conn = await cached!.promise;
  } catch (error) {
    cached!.promise = null;
    console.error('Database connection failed:', error);
    throw error;
  }

  return cached!.conn;
}

export default dbConnect;
