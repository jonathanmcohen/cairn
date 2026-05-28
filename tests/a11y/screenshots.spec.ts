/**
 * README screenshot capture (v0.9.1 G6). NOT a CI gate — gated behind
 * `CAIRN_CAPTURE_SCREENSHOTS=1` so the a11y job (which globs every
 * `tests/a11y/**\/*.spec.ts`) skips it. Run locally to (re)generate the
 * light+dark image set under `docs/screenshots/`:
 *
 *   source ~/.zshenv && rm -rf .next && pnpm build
 *   CAIRN_CAPTURE_SCREENSHOTS=1 pnpm test:a11y
 *
 * Reuses the a11y harness: the worker seeds a workspace + rich page + inline
 * database (tests/a11y/seed.ts), `signIn` injects the cached auth cookies, and
 * the playwright.config `light`/`dark` projects run this spec once each — so
 * every surface is captured in BOTH themes from a single test body. The `dark`
 * project gets the class-based next-themes init injected (colorScheme alone is
 * insufficient — see playwright.config DARK_INIT).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DARK_INIT } from '../../playwright.config';
import { expect, signIn, test } from './fixtures';

const CAPTURE = process.env.CAIRN_CAPTURE_SCREENSHOTS === '1';
const OUT = join(process.cwd(), 'docs', 'screenshots');

test.skip(!CAPTURE, 'screenshot capture only runs with CAIRN_CAPTURE_SCREENSHOTS=1');

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.beforeEach(async ({ page }, testInfo) => {
  // The dark project needs the class-based theme pre-seeded before hydration.
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

function shotPath(name: string, theme: string): string {
  return join(OUT, `${name}-${theme}.png`);
}

// `/` redirects to the first page's editor, so a dedicated app-shell shot
// would duplicate the editor one — the editor capture below already shows the
// full shell (sidebar + page + inline database).
test('block editor (rich content + inline database)', async ({ page, seeded }, info) => {
  await signIn(page, seeded);
  await page.goto(`/pages/${seeded.pageId}`);
  await page.waitForLoadState('networkidle');
  // Let the Yjs provider sync so the inline-database NodeView mounts.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shotPath('editor', info.project.name), fullPage: true });
});

test('command palette', async ({ page, seeded }, info) => {
  await signIn(page, seeded);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Meta+k');
  // The cmdk dialog animates in; wait for the input to be visible.
  await expect(page.getByPlaceholder(/search|type a command/i).first()).toBeVisible({
    timeout: 5000,
  });
  await page.screenshot({ path: shotPath('command-palette', info.project.name) });
});

test('developer settings — API keys', async ({ page, seeded }, info) => {
  await signIn(page, seeded);
  await page.goto('/settings/developer/api-keys');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: shotPath('settings-api-keys', info.project.name), fullPage: true });
});

test('automation settings', async ({ page, seeded }, info) => {
  await signIn(page, seeded);
  await page.goto('/settings/developer/automation');
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: shotPath('settings-automation', info.project.name),
    fullPage: true,
  });
});

test('webhook delivery dashboard', async ({ page, seeded }, info) => {
  await signIn(page, seeded);
  await page.goto(`/settings/admin/webhooks/${seeded.webhookId}/deliveries`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: shotPath('webhook-deliveries', info.project.name),
    fullPage: true,
  });
});
