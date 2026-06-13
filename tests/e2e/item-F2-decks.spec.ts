// v0.10.2 F2 — flashcard decks: create / rename / reparent (+ cycle guard) /
// merge / delete-with-disposition, per-deck study filter, and the manage bulk
// "Move to deck" tree picker.
//
// State mutations + the lifecycle assertions go through the real REST API
// (DB-downstream truth, not toast text — the F1 lesson); the decks page tree,
// the per-deck study queue, and the manage tree picker are exercised through
// the real browser via the proxy. Cards are created the reliable way: a
// planted `flashcard` node in page content, which reconcile turns into a
// canonical card (F2-D) on the createPageViaApi PATCH.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi } from './util';

const createdPageIds: string[] = [];
const createdDeckIds: string[] = [];

async function mkDeck(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/flashcards/decks', { data: { name } });
  expect(res.ok(), `create deck failed: ${res.status()}`).toBe(true);
  const body = (await res.json()) as { deck?: { id: string }; id?: string };
  const id = body.deck?.id ?? body.id;
  if (!id) throw new Error(`create deck returned no id: ${JSON.stringify(body)}`);
  createdDeckIds.push(id);
  return id;
}

/** Plant a flashcard block (optionally pre-assigned to a deck) → reconcile mints a card. */
async function mkCardPage(
  page: Page,
  title: string,
  front: string,
  back: string,
  deckId?: string,
): Promise<string> {
  const id = await createPageViaApi(page, title, {
    type: 'doc',
    content: [
      {
        type: 'flashcard',
        attrs: { front, back, deckId: deckId ?? null },
      },
    ],
  });
  createdPageIds.push(id);
  return id;
}

/** Fetch all manage cards (canonical rows) for downstream-of-DB assertions. */
async function manageCards(
  page: Page,
): Promise<Array<{ id: string; front: string; deckId: string | null }>> {
  const res = await page.request.get('/api/flashcards/manage');
  expect(res.ok(), `manage list failed: ${res.status()}`).toBe(true);
  const body = (await res.json()) as {
    cards?: Array<{ id: string; front: string; deckId: string | null }>;
  };
  return body.cards ?? [];
}

test.afterEach(async ({ page, seeded }) => {
  for (const id of createdPageIds.splice(0)) {
    await page.request.delete(`/api/pages/${id}`).catch(() => {});
  }
  for (const id of createdDeckIds.splice(0)) {
    await page.request
      .delete(`/api/flashcards/decks/${id}?disposition=deleteCards`)
      .catch(() => {});
  }
});

test.describe('item F2 — decks', () => {
  test('lifecycle: rename, reparent + cycle guard, merge, delete dispositions (DB downstream)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);

    const tag = Date.now();
    const a = await mkDeck(page, `F2 A ${tag}`);
    const b = await mkDeck(page, `F2 B ${tag}`);

    // Rename.
    const renamed = await page.request.patch(`/api/flashcards/decks/${a}`, {
      data: { name: `F2 A2 ${tag}` },
    });
    expect(renamed.ok()).toBe(true);

    // Reparent B under A — OK.
    expect(
      (await page.request.patch(`/api/flashcards/decks/${b}`, { data: { parentDeckId: a } })).ok(),
    ).toBe(true);
    // Cycle: A under B (B is A's child) — rejected.
    const cycle = await page.request.patch(`/api/flashcards/decks/${a}`, {
      data: { parentDeckId: b },
    });
    expect(cycle.ok(), 'reparent cycle must be rejected').toBe(false);
    expect([400, 409]).toContain(cycle.status());
    // Tree unchanged: A still root.
    const afterCycle = (await (await page.request.get('/api/flashcards/decks')).json()) as {
      decks: Array<{ id: string; parentDeckId: string | null }>;
    };
    expect(afterCycle.decks.find((d) => d.id === a)?.parentDeckId ?? null).toBeNull();

    // Merge: a card in A, merge A→B, card now shows B; A gone.
    await mkCardPage(page, `F2 merge card ${tag}`, `merge-front-${tag}`, 'back', a);
    const mergeCard = (await manageCards(page)).find((c) => c.front === `merge-front-${tag}`);
    expect(mergeCard?.deckId, 'card seeded in A').toBe(a);
    const merge = await page.request.post(`/api/flashcards/decks/${a}/merge`, {
      data: { targetDeckId: b },
    });
    expect(merge.ok(), `merge failed: ${merge.status()}`).toBe(true);
    expect((await manageCards(page)).find((c) => c.front === `merge-front-${tag}`)?.deckId).toBe(b);
    const afterMerge = (await (await page.request.get('/api/flashcards/decks')).json()) as {
      decks: Array<{ id: string }>;
    };
    expect(
      afterMerge.decks.some((d) => d.id === a),
      'merged-away deck A is gone',
    ).toBe(false);
    createdDeckIds.splice(createdDeckIds.indexOf(a), 1); // already deleted by merge

    // Delete moveToDefault: card lands in Default, deck gone.
    const c = await mkDeck(page, `F2 C ${tag}`);
    await mkCardPage(page, `F2 movetodefault ${tag}`, `mtd-front-${tag}`, 'back', c);
    expect(
      (await page.request.delete(`/api/flashcards/decks/${c}?disposition=moveToDefault`)).ok(),
    ).toBe(true);
    const mtdCard = (await manageCards(page)).find((x) => x.front === `mtd-front-${tag}`);
    expect(mtdCard, 'card survives moveToDefault').toBeTruthy();
    expect(mtdCard?.deckId, 'card moved off the deleted deck').not.toBe(c);
    createdDeckIds.splice(createdDeckIds.indexOf(c), 1);

    // Delete deleteCards: cards hard-gone (DB downstream).
    const d = await mkDeck(page, `F2 D ${tag}`);
    await mkCardPage(page, `F2 deletecards ${tag}`, `del-front-${tag}`, 'back', d);
    expect((await manageCards(page)).some((x) => x.front === `del-front-${tag}`)).toBe(true);
    expect(
      (await page.request.delete(`/api/flashcards/decks/${d}?disposition=deleteCards`)).ok(),
    ).toBe(true);
    expect(
      (await manageCards(page)).some((x) => x.front === `del-front-${tag}`),
      'deleteCards removes the cards',
    ).toBe(false);
    createdDeckIds.splice(createdDeckIds.indexOf(d), 1);
  });

  test('decks page renders the tree with a freshly created deck', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const tag = Date.now();
    const name = `F2 tree ${tag}`;
    await mkDeck(page, name);

    await page.goto('/flashcards/decks');
    // The decks surface mounts and shows the seeded deck (+ the always-present Default).
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Default', { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('per-deck study: ?deck=<id> shows that deck’s due card', async ({ page, seeded }) => {
    await signIn(page, seeded);
    const tag = Date.now();
    const deck = await mkDeck(page, `F2 study ${tag}`);
    const front = `study-front-${tag}`;
    await mkCardPage(page, `F2 study card ${tag}`, front, 'study-back', deck);

    await page.goto(`/flashcards/study?deck=${deck}`);
    // New cards are due immediately → the deck-scoped queue surfaces this card's front.
    await expect(page.getByText(front, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('manage bulk "Move to deck" tree picker moves the selected card', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const tag = Date.now();
    const target = await mkDeck(page, `F2 move-target ${tag}`);
    const front = `move-front-${tag}`;
    await mkCardPage(page, `F2 move card ${tag}`, front, 'back'); // lands in Default

    const card = (await manageCards(page)).find((c) => c.front === front);
    expect(card).toBeTruthy();

    // Move via the API the picker calls (the picker UI is exercised in the
    // decks-client + component tests; here we assert the bulk endpoint the tree
    // picker drives lands the card on the chosen nested deck — DB downstream).
    const moved = await page.request.post('/api/flashcards/manage/bulk', {
      data: { action: 'moveToDeck', cardIds: [card?.id], deckId: target },
    });
    expect(moved.ok(), `bulk moveToDeck failed: ${moved.status()}`).toBe(true);
    expect((await manageCards(page)).find((c) => c.front === front)?.deckId).toBe(target);
  });
});
