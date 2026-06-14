/**
 * v0.10.2 F1 Task B — write-through edit of an ATTACHED flashcard's front/back.
 *
 * The page's TipTap JSON (`pages.content`) is the source of truth for a
 * flashcard's text; the `flashcard_cards` row is a denormalized join target the
 * reconcile-on-save loop keeps in lockstep (keyed by `(page_id, block_id)`).
 * So editing the front/back of an attached card from the manage view must write
 * THROUGH to the source block, not just the card row — otherwise the next page
 * save would reconcile the stale block text back over our edit.
 *
 * This module is the pure JSON transform: walk the doc, find the `flashcard`
 * node whose `blockId` matches, and overwrite its `front`/`back` attrs. The
 * route then persists the patched doc via `updatePage`, which re-reconciles the
 * card row from the doc AND publishes the new content into any live Yjs session
 * (so a collab materialize() flush can't clobber the edit — see
 * `src/lib/pages/update.ts` + `publishContentToCollab`).
 *
 * Dependency-free (no Drizzle / React) so it stays unit-testable in isolation.
 */

export type FlashcardEdit = {
  front?: string;
  back?: string;
  deckTag?: string | null;
};

/**
 * Return a deep-cloned copy of `content` with the `flashcard` node matching
 * `blockId` updated. Returns `{ found: false }` when no matching block exists
 * (the route falls back to a row-only update + leaves the row authoritative).
 */
export function applyFlashcardEditToContent(
  content: unknown,
  blockId: string,
  edit: FlashcardEdit,
): { found: boolean; content: unknown } {
  // structuredClone keeps the original (possibly the live row's jsonb) intact.
  const cloned: unknown =
    typeof structuredClone === 'function'
      ? structuredClone(content)
      : JSON.parse(JSON.stringify(content ?? null));
  let found = false;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    };
    if (n.type === 'flashcard' && n.attrs && n.attrs.blockId === blockId) {
      found = true;
      if (edit.front !== undefined) n.attrs.front = edit.front;
      if (edit.back !== undefined) n.attrs.back = edit.back;
      if (edit.deckTag !== undefined) n.attrs.deckTag = edit.deckTag;
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(cloned);
  return { found, content: cloned };
}
