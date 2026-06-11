import {
  type Browser,
  type BrowserContext,
  test as base,
  type Cookie,
  type Page,
} from '@playwright/test';
import { TOUR_SEEN_WILDCARD_KEY, TOUR_VERSION } from '../../src/components/tour/storage';
import { type SeededA11y, seedA11yFixtures } from './seed';

type AuthCookies = Cookie[];

export type A11yFixtures = { seeded: SeededA11y; authCookies: AuthCookies };

export const test = base.extend<A11yFixtures, { seededWorker: SeededA11y }>({
  // v0.10.0 F3/H1 — suppress the onboarding tour's first-run auto-start for
  // EVERY page from this harness, not just the fixtures' signIn() path: the
  // legacy specs (auth-signout, slash-ux, …) drive the credentials form with
  // their own local helpers, and the tour popover was overlaying the UI under
  // test (11 reds, found at H1 measurement). Storage.ts honors the wildcard
  // `cairn:tour-seen:*` as a documented harness escape hatch. The F3 spec
  // re-enables the first-run path per page via `signIn(page, seeded,
  // { tour: 'fresh' })`, which registers a LATER init script that deletes the
  // marker (init scripts run in registration order).
  page: async ({ page }, use) => {
    await suppressTourAutostart(page);
    await use(page);
  },
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
  // not-'/login' predicate: '/' redirects to the landing page when the
  // workspace has pages, so a '**/' glob can miss the transient root (H1).
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

/**
 * Inject the worker's cached auth cookies into the current page's context so
 * subsequent navigations are authenticated, without re-driving the
 * (rate-limited) credentials form. Idempotent: callers continue to pass
 * `(page, seeded)`. We read the cached cookies through the worker-level cache
 * directly so callers don't have to thread `authCookies` everywhere.
 */
export async function signIn(
  page: Page,
  seeded: SeededA11y,
  opts: { tour?: 'seen' | 'fresh' } = {},
): Promise<void> {
  const browser = page.context().browser();
  if (!browser) throw new Error('a11y harness: page.context().browser() returned null');
  const cookies = await getOrCreateAuthCookies(browser, seeded);
  if (opts.tour === 'fresh') {
    await restoreTourFirstRun(page);
  }
  await page.context().addCookies(cookies);
}

/**
 * v0.10.0 F3/H1 — the onboarding tour auto-starts on first load when its
 * localStorage seen-marker is absent, which is true in EVERY fresh Playwright
 * context. The harness pre-seeds the wildcard marker (storage.ts honors
 * `cairn:tour-seen:*`) at the `page` fixture, so every spec from this file is
 * covered no matter how it signs in (the legacy specs drive the credentials
 * form with local helpers and never call signIn()).
 */
async function suppressTourAutostart(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, version]) => {
      try {
        localStorage.setItem(key, version);
      } catch {
        // ignore — worst case the tour shows and a spec fails loudly
      }
    },
    [TOUR_SEEN_WILDCARD_KEY, TOUR_VERSION] as const,
  );
}

/**
 * Re-enable the tour's first-run path for one page (the F3 spec). Init
 * scripts run in registration order, so this later script deletes the marker
 * the fixture's earlier script just set.
 */
async function restoreTourFirstRun(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, TOUR_SEEN_WILDCARD_KEY);
}

/**
 * Sign a SECOND user in inside their OWN fresh browser context, for two-actor
 * specs that need two distinct authenticated sessions at once. Unlike
 * {@link signIn} (which injects the worker-cached cookie jar for the primary
 * user), this drives the credentials form once for the given account — its
 * distinct email is a separate auth rate-limit bucket, so the single sign-in
 * won't trip the 5/min limit shared by the primary user. The caller owns the
 * returned context and must `context.close()` it (e.g. in a `finally`).
 */
export async function signInSecondUser(
  browser: Browser,
  user: { email: string; password: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Two-actor specs predate the F3 tour; suppress its first-run auto-start in
  // the second user's fresh context too (see suppressTourAutostart above).
  await suppressTourAutostart(page);
  // Per-email cookie cache (H1): NINE specs sign the default second user
  // (a11y-2) in through the real form. Once the de-rotted suite got ~2×
  // faster those attempts compressed inside the auth limiter's 5/min/ip+email
  // window and sign-ins started failing as 'Invalid email or password'
  // (item-D6 was the first casualty). Drive the form once per worker per
  // email; later calls inject the cached jar like the primary-user signIn().
  const cached = secondUserCookies.get(user.email);
  if (cached) {
    await context.addCookies(await cached);
    await page.goto('/');
    return { context, page };
  }
  const jar = (async () => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // Wait for LEAVING /login rather than for the literal '/' — once the
    // workspace has pages, '/' immediately redirects to the landing page
    // (resolveLandingPage), and a '**/' glob can miss the transient root and
    // hang for the full timeout.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
    return context.cookies();
  })();
  secondUserCookies.set(user.email, jar);
  try {
    await jar;
  } catch (err) {
    // Don't poison the cache with a failed sign-in.
    secondUserCookies.delete(user.email);
    throw err;
  }
  return { context, page };
}

const secondUserCookies = new Map<string, Promise<Cookie[]>>();

export { expect } from '@playwright/test';
