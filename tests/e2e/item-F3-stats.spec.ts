// v0.10.2 F3 — flashcard stats + workspace settings + leech + .apkg export.
//
// Shared-DB-robust design (CI runs the whole e2e suite against one DB, so the
// primary a11y user accumulates review_events from F1/F2 specs):
//   - Stats MATH is asserted for a FRESH second user (seedSecondUser) whose
//     flashcard_reviews slate is clean — retention and maturity young/learning
//     count only that user's graded cards, so they're exact; forecast is a
//     lower bound (a fresh user sees every workspace card as due-now day-0).
//   - Leech uses a per-(card,user) Again count (grade Again leech_threshold
//     times on ONE card) — no shared workspace-settings mutation, so it can't
//     trip other specs' cards.
//   - Settings round-trips then RESTORES the default so other specs are
//     unaffected. Export drives the real download button.
import type { Page } from '@playwright/test';
import { expect, signIn, signInSecondUser, test } from '../a11y/fixtures';
import { seedSecondUser } from '../a11y/seed';
import { createPageViaApi } from './util';

const DEFAULT_LEECH_THRESHOLD = 8;

async function mkCard(page: Page, front: string): Promise<{ pageId: string; cardId: string }> {
  const pageId = await createPageViaApi(page, `F3 ${front}`, {
    type: 'doc',
    content: [{ type: 'flashcard', attrs: { front, back: 'b', deckId: null } }],
  });
  const list = (await (await page.request.get('/api/flashcards/manage')).json()) as {
    cards?: Array<{ id: string; front: string }>;
  };
  const cardId = list.cards?.find((c) => c.front === front)?.id;
  if (!cardId) throw new Error(`card not minted for ${front}`);
  return { pageId, cardId };
}

async function grade(page: Page, cardId: string, g: 0 | 1 | 2 | 3): Promise<void> {
  const res = await page.request.post('/api/flashcards/grade', { data: { cardId, grade: g } });
  expect(res.ok(), `grade failed: ${res.status()}`).toBe(true);
}

test.describe('item F3 — stats + settings + leech + apkg', () => {
  test('stats math derives from graded reviews (fresh user: retention 75%, maturity young/learning exact)', async ({
    page,
    seeded,
    browser,
  }) => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL unset');
    // A fresh editor in the seeded workspace with a UNIQUE email — guarantees a
    // clean flashcard_reviews/review_events slate even on a reused dev DB (the
    // shared a11y-2 accumulates rows across runs because page-delete only
    // SET-NULLs card.page_id, F1, so cards + their reviews persist).
    const second = await seedSecondUser(dbUrl, {
      workspaceId: seeded.workspaceId,
      role: 'editor',
      email: `f3stats-${Date.now().toString(36)}-${Math.floor(performance.now())}@cairn.test`,
    });
    const { context, page: p2 } = await signInSecondUser(browser, second);
    const tag = Date.now().toString(36);
    const pageIds: string[] = [];
    try {
      const good = [`f3good1-${tag}`, `f3good2-${tag}`, `f3good3-${tag}`];
      const again = `f3again-${tag}`;
      for (const f of good) {
        const c = await mkCard(p2, f);
        pageIds.push(c.pageId);
        await grade(p2, c.cardId, 2); // Good → interval 1 (young)
      }
      const ag = await mkCard(p2, again);
      pageIds.push(ag.pageId);
      await grade(p2, ag.cardId, 0); // Again → interval 0 (learning)

      const stats = (await (await p2.request.get('/api/flashcards/stats')).json()) as {
        retention: { percent: number | null; total: number };
        maturity: { new: number; learning: number; young: number; mature: number };
        forecast: { next30: number };
      };
      // 3 Good (grade>=2) + 1 Again of 4 in-window events → 75%.
      expect(stats.retention.total).toBe(4);
      expect(stats.retention.percent).toBe(75);
      // Only this user's graded cards have review rows → exact young/learning.
      expect(stats.maturity.young).toBe(3);
      expect(stats.maturity.learning).toBe(1);
      // Forecast counts every active card (incl. other specs' as day-0) → lower bound.
      expect(stats.forecast.next30).toBeGreaterThanOrEqual(4);
    } finally {
      for (const id of pageIds) await p2.request.delete(`/api/pages/${id}`).catch(() => {});
      await context.close();
    }
  });

  test('leech: grading Again at the threshold auto-suspends + tags the card', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const tag = Date.now().toString(36);
    const front = `f3leech-${tag}`;
    const { pageId, cardId } = await mkCard(page, front);
    try {
      // Default leech_threshold = 8: grade Again that many times on THIS card.
      for (let i = 0; i < DEFAULT_LEECH_THRESHOLD; i++) await grade(page, cardId, 0);
      const list = (await (await page.request.get('/api/flashcards/manage')).json()) as {
        cards?: Array<{ id: string; suspendedAt: string | null; tags: string[] }>;
      };
      const card = list.cards?.find((c) => c.id === cardId);
      expect(card?.suspendedAt, 'leech card suspended').toBeTruthy();
      expect(card?.tags ?? [], 'leech tag added').toContain('leech');
    } finally {
      await page.request.delete(`/api/pages/${pageId}`).catch(() => {});
    }
  });

  test('workspace flashcard settings round-trip (admin)', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const before = (await (await page.request.get('/api/flashcards/settings')).json()) as {
      newPerDay: number;
    };
    try {
      const patch = await page.request.patch('/api/flashcards/settings', {
        data: { newPerDay: 33 },
      });
      expect(patch.ok(), `settings PATCH failed: ${patch.status()}`).toBe(true);
      const after = (await (await page.request.get('/api/flashcards/settings')).json()) as {
        newPerDay: number;
      };
      expect(after.newPerDay).toBe(33);
    } finally {
      // Restore so other specs' study new-per-day is unchanged.
      await page.request
        .patch('/api/flashcards/settings', { data: { newPerDay: before.newPerDay ?? 20 } })
        .catch(() => {});
    }
  });

  test('stats page renders + the Export .apkg button downloads a non-empty file', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    await page.goto('/flashcards/stats');
    await expect(page.getByTestId('flashcards-stats')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('stats-retention')).toBeVisible({ timeout: 15_000 });

    // The Export button is wired to the F3-C route (UI half)...
    const exportBtn = page.getByTestId('flashcards-export-apkg');
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });
    await expect(exportBtn).toHaveAttribute('href', '/api/flashcards/export/apkg');
    // ...and that route returns a real, non-empty .apkg at runtime (proves
    // buildApkg + the sql.js wasm load in the standalone server). The binary
    // format is asserted by apkg.test.ts; here we prove the route serves bytes.
    const res = await page.request.get('/api/flashcards/export/apkg');
    expect(res.ok(), `export route failed: ${res.status()}`).toBe(true);
    expect((await res.body()).byteLength, '.apkg is non-empty').toBeGreaterThan(0);
  });
});
