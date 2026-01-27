/**
 * Global Teardown for Jest
 *
 * This file runs once after all test suites complete.
 * It stops the MongoDB Memory Server.
 */

import type { MongoMemoryServer } from 'mongodb-memory-server';

declare global {
  var __MONGOD__: MongoMemoryServer | undefined;
}

export default async function globalTeardown(): Promise<void> {
  const mongod = globalThis.__MONGOD__;

  if (mongod) {
    await mongod.stop();
    console.log('\nMongoDB Memory Server stopped.\n');
  }
}
