import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// The test-runner process (which runs the seed) needs DATABASE_URL/AUTH_SECRET
// from .env; only the webServer subprocess otherwise inherits the shell env.
loadEnv({ quiet: true });

const PORT = Number(process.env.A11Y_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
// Local Hocuspocus collab server for the a11y harness. The editor's Yjs
// provider has to sync against a collab server for the inline database
// NodeView (and other custom nodes) to actually mount — without it the
// `provider.synced` callback never fires and the editor's empty-doc seed
// from `pages.content` is never invoked, so the database `<table>` never
// renders.
const COLLAB_PORT = Number(process.env.A11Y_COLLAB_PORT ?? 11234);
const COLLAB_URL = `ws://localhost:${COLLAB_PORT}`;

/**
 * Force dark mode for the `dark` project. The app's theme is `next-themes`
 * CLASS-based (CLAUDE.md), NOT `prefers-color-scheme`, so a plain
 * `colorScheme: 'dark'` is insufficient. We pre-seed `localStorage.theme='dark'`
 * and add the `dark` class to <html> on every navigation, which is what
 * next-themes reads on hydration.
 */
const DARK_INIT = `
  try {
    localStorage.setItem('theme', 'dark');
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  } catch {}
`;

export default defineConfig({
  testDir: './tests/a11y',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // serial: one booted app + one seeded DB
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
  },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    {
      name: 'dark',
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'dark',
      },
      // Inject the class-based dark theme before any page script runs.
      metadata: { theme: 'dark' },
    },
  ],
  // Boot the built app against the test DB. `pnpm build` is run by the gate
  // caller before this. The Next config is `output: 'standalone'`, so `next
  // start` is unsupported — we run migrations, then launch the standalone
  // server (`.next/standalone/server.js`), which reads PORT/HOSTNAME from env.
  //
  // We also start a local Hocuspocus collab server: the editor only mounts
  // custom NodeViews (database, callout, image, file…) after the Yjs provider
  // has synced. Without a reachable collab server `provider.synced` never
  // fires and the database table under audit doesn't render. We probe its
  // port with `tcpPort` since Hocuspocus is a pure WS server (no HTTP GET).
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

export { DARK_INIT };
