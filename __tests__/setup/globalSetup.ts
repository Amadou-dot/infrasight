/**
 * Global Setup for Jest
 *
 * This file runs once before all test suites.
 * It starts the MongoDB Memory Server and stores the URI for tests.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';

declare global {
   
  var __MONGOD__: MongoMemoryServer | undefined;
}

export default async function globalSetup(): Promise<void> {
  // Start MongoDB Memory Server
  const mongod = await MongoMemoryServer.create({
    instance: {
      dbName: 'infrasight-test',
    },
  });

  const uri = mongod.getUri();

  // Store the server instance and URI for later use
  globalThis.__MONGOD__ = mongod;

  // Set environment variable for tests to use
  process.env.MONGODB_URI = uri;
  process.env.NODE_ENV = 'test';

  // Set mock Pusher credentials for tests
  process.env.PUSHER_APP_ID = 'test-app-id';
  process.env.PUSHER_KEY = 'test-key';
  process.env.PUSHER_SECRET = 'test-secret';
  process.env.PUSHER_CLUSTER = 'test-cluster';
  process.env.NEXT_PUBLIC_PUSHER_KEY = 'test-key';
  process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'test-cluster';

  console.log(`\nMongoDB Memory Server started at: ${uri}\n`);
}
