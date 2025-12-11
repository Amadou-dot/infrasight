import dbConnect from '../lib/db';
import _Reading from '../models/Reading';
import mongoose from 'mongoose';

async function setupTTL() {
  try {
    await dbConnect();
    console.log('Connected to MongoDB. Setting up TTL index...');

    // Access the native collection to manage indexes directly if needed,
    // but Mongoose should handle it if we updated the schema.
    // However, the user explicitly asked for a command/script.

    const collection = mongoose.connection.collection('readings');

    // Check existing indexes
    const indexes = await collection.indexes();
    console.log('Existing indexes:', indexes);

    // Create the index
    await collection.createIndex(
      { timestamp: 1 },
      { expireAfterSeconds: 604800, background: true }
    );

    console.log(
      'TTL index created successfully on "timestamp" field (7 days).'
    );
  } catch (error) {
    console.error('Error setting up TTL:', error);
  } finally {
    await mongoose.disconnect();
  }
}

setupTTL();
