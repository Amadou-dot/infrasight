/**
 * Jest Configuration for Infrasight v2
 *
 * This configuration supports:
 * - TypeScript with ts-jest
 * - MongoDB Memory Server for database tests
 * - Path aliases matching tsconfig.json
 * - Separate unit and integration test patterns
 * - Separate jsdom project for component tests
 */

/** Shared settings used by both projects */
const sharedSettings = {
  // Module path aliases (matching tsconfig.json)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },

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

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,
};

/** @type {import('jest').Config} */
const config = {
  // Use projects to separate node (API/model) tests from jsdom (component) tests
  projects: [
    {
      // Node tests: API routes, models, validations, lib utilities
      displayName: 'node',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/__tests__'],
      testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.integration.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
      setupFilesAfterEnv: ['<rootDir>/__tests__/setup/jest.setup.ts'],
      globalSetup: '<rootDir>/__tests__/setup/globalSetup.ts',
      globalTeardown: '<rootDir>/__tests__/setup/globalTeardown.ts',
      testTimeout: 30000,
      ...sharedSettings,
    },
    {
      // Component tests: React components using jsdom
      displayName: 'jsdom',
      preset: 'ts-jest',
      testEnvironment: 'jest-environment-jsdom',
      roots: ['<rootDir>/__tests__'],
      testMatch: ['**/__tests__/**/*.test.tsx'],
      testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
      setupFilesAfterEnv: ['<rootDir>/__tests__/setup/jest.setup.jsdom.ts'],
      testTimeout: 15000,
      ...sharedSettings,
    },
  ],

  // Coverage configuration (applies globally across projects)
  collectCoverageFrom: [
    'models/v2/**/*.ts',
    'lib/**/*.ts',
    'app/api/v2/**/*.ts',
    'components/**/*.tsx',
    'app/devices/_components/**/*.tsx',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/_deprecated/**',
    '!**/deprecated/**',
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 55,
      functions: 55,
      lines: 75,
      statements: 75,
    },
  },

  // Coverage output directory
  coverageDirectory: '<rootDir>/coverage',

  // Coverage reporters
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],

  // Maximum number of workers (for CI)
  maxWorkers: '50%',

  // Force exit after tests complete (useful for MongoDB connections)
  forceExit: true,

  // Detect open handles (useful for debugging)
  detectOpenHandles: true,
};

module.exports = config;
