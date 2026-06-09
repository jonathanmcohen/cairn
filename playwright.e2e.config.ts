import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// v0.9.18 Gate 3 — runtime specs that load the REAL app and assert UI state,
// so a passing unit/JSDOM spec can no longer mask a browser-level regression.
// Mirrors playwright.config.ts (the a11y harness) but points testDir at
// tests/e2e/, which holds the per-item carry-forward repros. The booted
// standalone server + local Hocuspocus collab server are identical to the
// a11y harness; tests/e2e specs reuse `tests/a11y/fixtures` for the seeded
// user + credentials sign-in, so the assertion path matches the live surface.
loadEnv({ quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3200);
const BASE_URL = `http://localhost:${PORT}`;
const COLLAB_PORT = Number(process.env.E2E_COLLAB_PORT ?? 11334);
const COLLAB_URL = `ws://localhost:${COLLAB_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // serial: one booted app + one seeded DB
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    // Capture artifacts for the PR repro strip (Gate 2).
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } }],
  // Boot the built standalone server against the test DB. The caller runs
  // `pnpm build` first. `output: 'standalone'` => no `next start`; we migrate,
  // copy static assets into the standalone tree, then launch server.js.
  webServer: [
    {
      command:
        'pnpm db:migrate && rm -rf .next/standalone/.next/static && ' +
        'cp -R .next/static .next/standalone/.next/static && node .next/standalone/server.js',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(PORT),
        HOSTNAME: '127.0.0.1',
        NEXTAUTH_URL: BASE_URL,
        COLLAB_URL,
      },
    },
    {
      command: 'pnpm exec tsx collab/server.ts',
      port: COLLAB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        COLLAB_PORT: String(COLLAB_PORT),
      },
    },
  ],
});
