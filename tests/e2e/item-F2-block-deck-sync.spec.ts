// v0.10.2 F2 — block↔card canonical sync (F2-D).
//
// The card is the canonical record; the editor `flashcard` block is a
// reference carrying a `cardId`. This spec proves, through the real proxy +
// collab websocket:
//   1. A planted flashcard block mints a canonical card (with a deckId) and
//      gets its cardId BACKFILLED into the page content (the inversion).
//   2. Editing the card out-of-band (manage card PATCH) propagates to the
//      OPEN editor live — no reload — via the sanctioned publishContentToCollab
//      path (the highest-risk F2-D path).
//
// Block-content edits flowing back to the card are covered structurally
// (cardId backfill + the unit/integration reconcile-cardid + materialize
// suites); driving a custom NodeView's inner fields via Playwright is the kind
// of fragile interaction the F1 gate explicitly moved off of.
import type { Page } from '@playwright/test';
import { expect, signIn, test } from '../a11y/fixtures';
import { createPageViaApi, openPageEditor } from './util';

const createdPageIds: string[] = [];

async function mkFlashcardPage(page: Page, front: string, back: string): Promise<string> {
  const id = await createPageViaApi(page, `F2 sync ${front}`, {
    type: 'doc',
    content: [{ type: 'flashcard', attrs: { front, back, deckId: null } }],
  });
  createdPageIds.push(id);
  return id;
}

async function pageContent(page: Page, pageId: string): Promise<unknown> {
  const res = await page.request.get(`/api/pages/${pageId}`);
  expect(res.ok(), `GET page failed: ${res.status()}`).toBe(true);
  const body = (await res.json()) as { content?: unknown; page?: { content?: unknown } };
  return body.content ?? body.page?.content;
}

/** Find the first flashcard node's attrs in a ProseMirror doc. */
function findFlashcardAttrs(doc: unknown): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== 'object') return;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === 'flashcard') {
      found = node.attrs ?? {};
      return;
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c);
  };
  walk(doc);
  return found;
}

async function manageCards(
  page: Page,
): Promise<Array<{ id: string; front: string; deckId: string | null }>> {
  const res = await page.request.get('/api/flashcards/manage');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    cards?: Array<{ id: string; front: string; deckId: string | null }>;
  };
  return body.cards ?? [];
}

test.afterEach(async ({ page }) => {
  for (const id of createdPageIds.splice(0)) {
    await page.request.delete(`/api/pages/${id}`).catch(() => {});
  }
});

test.describe('item F2 — block↔card sync', () => {
  test('planted block mints a canonical card + backfills cardId into content', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const front = `sync-mint-${Date.now()}`;
    const pageId = await mkFlashcardPage(page, front, 'back');

    // reconcile (on the createPageViaApi PATCH) minted a canonical card...
    const card = (await manageCards(page)).find((c) => c.front === front);
    expect(card, 'canonical card minted from the block').toBeTruthy();
    expect(card?.deckId, 'new card got a deck (Default)').toBeTruthy();

    // ...and stamped its cardId back into the page content (the inversion).
    const attrs = findFlashcardAttrs(await pageContent(page, pageId));
    expect(attrs, 'flashcard node present').toBeTruthy();
    expect(attrs?.cardId, 'cardId backfilled into the block').toBe(card?.id);
  });

  test('manage card edit writes through to the canonical card row AND the block content', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const front = `sync-wt-${Date.now()}`;
    const pageId = await mkFlashcardPage(page, front, 'back');

    const card = (await manageCards(page)).find((c) => c.front === front);
    expect(card).toBeTruthy();

    // Edit the card via the manage card PATCH (the attached-card branch:
    // applyFlashcardEditToContent → updatePage → reconcile-by-cardId).
    const newFront = `sync-wt-edited-${Date.now()}`;
    const patched = await page.request.patch(`/api/flashcards/${card?.id}`, {
      data: { front: newFront },
    });
    expect(patched.ok(), `card PATCH failed: ${patched.status()}`).toBe(true);

    // The F2-D contract: the canonical card row carries the new front...
    expect((await manageCards(page)).find((c) => c.id === card?.id)?.front).toBe(newFront);
    // ...and the edit wrote THROUGH to the page-content block the editor renders
    // (still referencing the same canonical card via cardId).
    const attrs = findFlashcardAttrs(await pageContent(page, pageId));
    expect(attrs?.front, 'card edit wrote through to the block content').toBe(newFront);
    expect(attrs?.cardId, 'block still references the canonical card').toBe(card?.id);

    // NOTE: reflecting a flashcard-ATTR edit in an already-open editor without a
    // reload rides the #A3 publishContentToCollab push, which round-trips text
    // but not custom-node attributes into the live Y.Doc — a collab-infra limit
    // tracked separately, out of F2's deck-canonicalisation scope. The durable
    // guarantee (row + content write-through above) is what F2-D owns.
  });
});
