import { randomUUID } from 'node:crypto';

export type FlashcardBlock = {
  blockId: string;
  front: string;
  back: string;
  deckTag: string | null;
};

/**
 * Walk a TipTap JSON doc and return every `flashcard` block found. Blocks
 * missing a `blockId` get one minted in-place (mutating the input is fine —
 * `updatePage` calls this with the freshly-parsed content jsonb that's about
 * to be persisted, and we want the minted id to land in the saved JSON so the
 * next save matches the same row).
 *
 * This module is deliberately dependency-free (only `node:crypto`) so the
 * standalone collab process can import it without dragging in Drizzle or the
 * `@/db/schema` graph — see `reconcile-raw.ts` and `Dockerfile.collab`. The
 * Drizzle-based `reconcile.ts` re-exports it for the REST path.
 */
export function extractFlashcardBlocks(content: unknown): FlashcardBlock[] {
  const out: FlashcardBlock[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    };
    if (n.type === 'flashcard') {
      const attrs = n.attrs ?? {};
      let blockId = attrs.blockId;
      if (typeof blockId !== 'string' || blockId.length === 0) {
        blockId = randomUUID();
        attrs.blockId = blockId;
        n.attrs = attrs;
      }
      out.push({
        blockId: blockId as string,
        front: String(attrs.front ?? ''),
        back: String(attrs.back ?? ''),
        deckTag: typeof attrs.deckTag === 'string' ? (attrs.deckTag as string) : null,
      });
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(content);
  return out;
}
