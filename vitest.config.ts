import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/server/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Run test files serially in a single worker. Each file owns its own
    // Testcontainers Postgres lifecycle via beforeAll/afterAll (see
    // tests/helpers/db.ts), so isolation MUST stay on: with isolate:false the
    // module-level container singleton is shared across files, and the first
    // file's afterAll tears down the container later files still expect →
    // ECONNREFUSED. isolate:true gives each file a fresh module registry.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    isolate: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
