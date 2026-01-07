/**
 * Jest Configuration for Infrasight v2
 *
 * This configuration supports:
 * - TypeScript with ts-jest
 * - MongoDB Memory Server for database tests
 * - Path aliases matching tsconfig.json
 * - Separate unit and integration test patterns
 */

/** @type {import('jest').Config} */
const config = {
  // Use ts-jest for TypeScript support
  preset: 'ts-jest',

  // Test environment for Node.js (API routes, models)
  testEnvironment: 'node',

  // Root directory for tests
  roots: ['<rootDir>/__tests__'],

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.integration.test.ts',
  ],

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],

  // Module path aliases (matching tsconfig.json)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },

  // Setup files to run after Jest is initialized
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/jest.setup.ts'],

  // Global setup for MongoDB Memory Server
  globalSetup: '<rootDir>/__tests__/setup/globalSetup.ts',
  globalTeardown: '<rootDir>/__tests__/setup/globalTeardown.ts',

  // Coverage configuration
  collectCoverageFrom: [
    'models/v2/**/*.ts',
    'lib/**/*.ts',
    'app/api/v2/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/_deprecated/**',
    '!**/deprecated/**',
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 30,   // Phase 1: 35% → Target: 70%
      functions: 35,  // Phase 1: 40% → Target: 75%
      lines: 55,      // Phase 1: 59% → Target: 80%
      statements: 55, // Phase 1: 58% → Target: 80%
    },
  },

  // Coverage output directory
  coverageDirectory: '<rootDir>/coverage',

  // Coverage reporters
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],

  // TypeScript configuration
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        isolatedModules: true,
      },
    ],
  },

  // Maximum number of workers (for CI)
  maxWorkers: '50%',

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Timeout for each test (30 seconds for database tests)
  testTimeout: 30000,

  // Force exit after tests complete (useful for MongoDB connections)
  forceExit: true,

  // Detect open handles (useful for debugging)
  detectOpenHandles: true,

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};

module.exports = config;
