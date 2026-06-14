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
import type { Page } from '@playwright/test';
import { DARK_INIT } from '../../playwright.config';
import { createPageViaApi, pmDoc, pmHeading, pmParagraph } from '../e2e/util';
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

// ---------------------------------------------------------------------------
// v0.10.2 — additional feature showcases. Each captures a surface that did not
// exist in the original set; flashcards content + a search corpus are seeded
// through the real REST API (cookie'd via signIn) so the surfaces render
// populated rather than empty.
// ---------------------------------------------------------------------------

/** Mint a handful of flashcards via the editor block + grade them so the stats
 *  and manage surfaces render with real review history. */
async function seedFlashcardsForShots(page: Page): Promise<void> {
  const cards: Array<[string, string, 0 | 1 | 2 | 3]> = [
    ['Capital of France?', 'Paris', 3],
    ['What is 2 + 2?', '4', 2],
    ['Largest planet in the Solar System?', 'Jupiter', 2],
    ['Chemical formula for water?', 'H₂O', 1],
    ['Speed of light (km/s)?', '299,792', 0],
    ['Author of "1984"?', 'George Orwell', 2],
  ];
  for (const [front, back, grade] of cards) {
    await createPageViaApi(page, `Flashcard — ${front}`, {
      type: 'doc',
      content: [{ type: 'flashcard', attrs: { front, back, deckId: null } }],
    });
    const list = (await (await page.request.get('/api/flashcards/manage')).json()) as {
      cards?: Array<{ id: string; front: string }>;
    };
    const card = list.cards?.find((c) => c.front === front);
    if (card) {
      await page.request.post('/api/flashcards/grade', { data: { cardId: card.id, grade } });
    }
  }
}

test('flashcards — statistics', async ({ page, seeded }, info) => {
  await signIn(page, seeded);
  await seedFlashcardsForShots(page);
  await page.goto('/flashcards/stats');
  await expect(page.getByTestId('flashcards-stats')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: shotPath('flashcards-stats', info.project.name), fullPage: true });
});

test('flashcards — manage', async ({ page, seeded }, info) => {
  await signIn(page, seeded);
  await seedFlashcardsForShots(page);
  await page.goto('/flashcards/manage');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: shotPath('flashcards-manage', info.project.name), fullPage: true });
});

test('search results', async ({ page, seeded }, info) => {
  await signIn(page, seeded);
  for (const title of ['Q3 Roadmap', 'Engineering Roadmap', 'Product Roadmap Notes']) {
    await createPageViaApi(
      page,
      title,
      pmDoc(
        pmHeading(1, title),
        pmParagraph('Planning and roadmap details for the team this quarter.'),
      ),
    );
  }
  await page.goto('/search?q=roadmap');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: shotPath('search', info.project.name), fullPage: true });
});
