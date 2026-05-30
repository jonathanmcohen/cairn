import { test as base, type Cookie, type Page } from '@playwright/test';
import { type SeededA11y, seedA11yFixtures } from './seed';

type AuthCookies = Cookie[];

export type A11yFixtures = { seeded: SeededA11y; authCookies: AuthCookies };

export const test = base.extend<A11yFixtures, { seededWorker: SeededA11y }>({
  // One seed per worker; tests share it (read-only screens).
  seededWorker: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright worker-fixture signature
    async ({}, use) => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL required for the a11y harness');
      const seeded = await seedA11yFixtures(url);
      await use(seeded);
    },
    { scope: 'worker' },
  ],
  seeded: async ({ seededWorker }, use) => {
    await use(seededWorker);
  },
  // Per-test fixture (not auto): the spec opts in by destructuring `authCookies`
  // or, more commonly, by calling `signIn(page, seeded)` which reads the
  // cookies through the test fixture context. Sign-in happens once per worker
  // via a module-level lazy promise; subsequent tests reuse the cached cookie
  // jar so we don't trip the auth rate-limit (5/min/ip+email).
  authCookies: async ({ browser, seeded }, use) => {
    const cookies = await getOrCreateAuthCookies(browser, seeded);
    await use(cookies);
  },
});

let cachedCookies: Promise<AuthCookies> | null = null;
async function getOrCreateAuthCookies(
  browser: import('@playwright/test').Browser,
  seeded: SeededA11y,
): Promise<AuthCookies> {
  cachedCookies ??= (async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await doCredentialsSignIn(page, seeded);
      return await ctx.cookies();
    } finally {
      await ctx.close();
    }
  })();
  return cachedCookies;
}

/** Drive the real credentials form (used once per worker via the cache above). */
async function doCredentialsSignIn(page: Page, seeded: SeededA11y): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(seeded.userEmail);
  await page.locator('input[name="password"]').fill(seeded.userPassword);
  // Exact match: the login page also has a "Sign in with a passkey" button, so a
  // loose /sign in/i resolves to 2 elements (Playwright strict-mode violation).
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

/**
 * Inject the worker's cached auth cookies into the current page's context so
 * subsequent navigations are authenticated, without re-driving the
 * (rate-limited) credentials form. Idempotent: callers continue to pass
 * `(page, seeded)`. We read the cached cookies through the worker-level cache
 * directly so callers don't have to thread `authCookies` everywhere.
 */
export async function signIn(page: Page, seeded: SeededA11y): Promise<void> {
  const browser = page.context().browser();
  if (!browser) throw new Error('a11y harness: page.context().browser() returned null');
  const cookies = await getOrCreateAuthCookies(browser, seeded);
  await page.context().addCookies(cookies);
}

export { expect } from '@playwright/test';
