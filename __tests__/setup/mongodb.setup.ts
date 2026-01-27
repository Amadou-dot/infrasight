/**
 * MongoDB Test Utilities
 *
 * Provides helper functions for working with MongoDB in tests.
 */

import mongoose from 'mongoose';

/**
 * Interface for MongoDB connection state
 */
interface MongoDBConnectionState {
  isConnected: boolean;
  connectionString: string | null;
}

/**
 * Get the current MongoDB connection state
 */
export function getConnectionState(): MongoDBConnectionState {
  return {
    isConnected: mongoose.connection.readyState === 1,
    connectionString: process.env.MONGODB_URI || null,
  };
}

/**
 * Clear all data from a specific collection
 */
export async function clearCollection(collectionName: string): Promise<void> {
  if (mongoose.connection.readyState !== 1) throw new Error('Not connected to MongoDB');

  const collection = mongoose.connection.collections[collectionName];
  if (collection) await collection.deleteMany({});
}

/**
 * Clear all data from all collections
 */
export async function clearAllCollections(): Promise<void> {
  if (mongoose.connection.readyState !== 1) throw new Error('Not connected to MongoDB');

  const collections = mongoose.connection.collections;

  for (const key in collections) await collections[key].deleteMany({});
}

/**
 * Drop all collections (more thorough than clearing)
 */
export async function dropAllCollections(): Promise<void> {
  if (mongoose.connection.readyState !== 1) throw new Error('Not connected to MongoDB');

  const collections = mongoose.connection.collections;

  for (const key in collections)
    try {
      await collections[key].drop();
    } catch {
      // Collection might not exist, ignore
    }
}

/**
 * Get the count of documents in a collection
 */
export async function getCollectionCount(collectionName: string): Promise<number> {
  if (mongoose.connection.readyState !== 1) throw new Error('Not connected to MongoDB');

  const collection = mongoose.connection.collections[collectionName];
  if (!collection) return 0;

  return collection.countDocuments();
}

/**
 * Wait for database to be ready
 */
export async function waitForConnection(timeoutMs: number = 5000): Promise<void> {
  const startTime = Date.now();

  while (mongoose.connection.readyState !== 1) {
    if (Date.now() - startTime > timeoutMs) throw new Error('MongoDB connection timeout');

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Create a clean database state for testing
 */
export async function setupCleanDatabase(): Promise<void> {
  await waitForConnection();
  await dropAllCollections();
}

/**
 * Check if a collection exists
 */
export async function collectionExists(collectionName: string): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) throw new Error('Not connected to MongoDB');

  const collections = await mongoose.connection.db?.listCollections().toArray();
  return collections?.some(col => col.name === collectionName) || false;
}
