import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// The test-runner process (which runs the seed) needs DATABASE_URL/AUTH_SECRET
// from .env; only the webServer subprocess otherwise inherits the shell env.
loadEnv({ quiet: true });

const PORT = Number(process.env.A11Y_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

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
  webServer: {
    // The standalone bundle ships `public/` but not `.next/static` (the
    // Dockerfile copies it in the image build); mirror that copy here so static
    // assets resolve, then migrate + boot.
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
    },
  },
});

export { DARK_INIT };
