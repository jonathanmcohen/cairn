import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.{ts,tsx}',
      'tests/**/*.spec.{ts,tsx}',
      'src/server/**/*.test.ts',
    ],
    // CRITICAL: tests/a11y and tests/e2e are Playwright specs (*.spec.ts) that
    // import @playwright/test — they MUST NOT be collected by Vitest or the whole
    // suite fails at collection. Vitest's defaultExclude is only node_modules/.git,
    // so we re-include those defaults AND add the Playwright dirs. tests/e2e-flag
    // is a real Vitest *.test.ts (encryption-roundtrip) — do NOT exclude it.
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      'tests/a11y/**',
      'tests/e2e/**',
    ],
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
    server: {
      deps: {
        // next-auth's ESM build (`lib/env.js`) imports the bare specifier
        // `next/server`, which Node's resolver can't map through next's
        // `exports` field under Vitest (it errors suggesting `next/server.js`).
        // Inlining next-auth makes Vite transform it so the `next/server` alias
        // below is applied to that import, letting `@/lib/auth/config` import.
        inline: [/next-auth/],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'next/server': path.resolve(__dirname, 'node_modules/next/server.js'),
    },
  },
});
