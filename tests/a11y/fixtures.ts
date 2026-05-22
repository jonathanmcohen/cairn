import { test as base, type Page } from '@playwright/test';
import { type SeededA11y, seedA11yFixtures } from './seed';

export type A11yFixtures = { seeded: SeededA11y };

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
});

/**
 * Sign in through the real credentials form so the session cookie is authentic.
 *
 * The login route is `/login` and the inputs carry `name="email"` / `name="password"`
 * (id-matched <Label htmlFor>). We target by `name` so the helper survives the
 * labelling work in later tasks; the post-login landing page is `/` (the app shell).
 */
export async function signIn(page: Page, seeded: SeededA11y): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(seeded.userEmail);
  await page.locator('input[name="password"]').fill(seeded.userPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  // The form does router.push('/') on success.
  await page.waitForURL('**/', { timeout: 30_000 });
}

export { expect } from '@playwright/test';
