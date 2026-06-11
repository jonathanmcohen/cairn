import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
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

// item C1 — the backup snapshot UI spec POSTs /api/admin/backups, which spawns
// `node dist/server/cli.js backup --out $CAIRN_BACKUP_DIR` from the booted
// server. Bundles land in a gitignored dir under the repo root; the CLI's
// uploads tar reads $UPLOAD_DIR (default /data/uploads, absent on dev boxes),
// so it gets its own pre-created dir too.
const BACKUP_DIR = path.resolve(process.cwd(), '.e2e-backups');
const UPLOADS_DIR = path.join(BACKUP_DIR, 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });
// macOS keeps pg_dump in the unlinked libpq keg; prepend it only when the dir
// exists so the Linux CI runner (pg_dump natively on PATH) is unaffected.
const LIBPQ_BIN = '/opt/homebrew/opt/libpq/bin';
const E2E_PATH = existsSync(LIBPQ_BIN)
  ? `${LIBPQ_BIN}:${process.env.PATH ?? ''}`
  : (process.env.PATH ?? '');

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
        // item A3 — the publish path under guard (REST PATCH → collab internal
        // /replace → Yjs broadcast → live editor) is env-gated and OFF when
        // CAIRN_COLLAB_INTERNAL_URL is unset (src/lib/collab/publish-client.ts).
        // Point the booted Next server at the harness collab process (the
        // internal HTTP control plane shares the WS port), exactly like
        // docker-compose.yml wires it in production, so
        // tests/e2e/item-A3-api-content-vs-yjs.spec.ts exercises the real path.
        // AUTH_SECRET (the bearer both sides compare) comes from .env via
        // loadEnv above.
        CAIRN_COLLAB_INTERNAL_URL: `http://localhost:${COLLAB_PORT}`,
        // item C1 — see BACKUP_DIR/UPLOADS_DIR/E2E_PATH above.
        CAIRN_BACKUP_DIR: BACKUP_DIR,
        UPLOAD_DIR: UPLOADS_DIR,
        PATH: E2E_PATH,
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
