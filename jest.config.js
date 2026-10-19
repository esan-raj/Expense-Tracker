/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Deno-style relative imports used by supabase/functions/*
    '^(\\.{1,2}/.*)\\.ts$': '$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          types: ['jest'],
          // Allow Deno-style `./mod.ts` imports used under supabase/functions.
          allowImportingTsExtensions: true,
          moduleResolution: 'bundler',
          noEmit: true,
        },
      },
    ],
  },
};
