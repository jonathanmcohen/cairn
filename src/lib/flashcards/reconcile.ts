import { randomUUID } from 'node:crypto';
import { and, eq, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { upsertCard } from './upsert-card';

type Tx = Pick<
  PostgresJsDatabase<typeof schema>,
  'select' | 'delete' | 'insert' | 'update'
>;

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

/**
 * Sync `flashcard_cards` rows with the flashcard blocks present in the saved
 * page content. Mirrors `reindexPageLinks`: inside the same transaction as the
 * page update so a failed reconcile rolls back the content write.
 *
 *   - any flashcard block in the doc → upsert into `flashcard_cards` keyed
 *     by `(page_id, block_id)`.
 *   - any existing card whose block-id is no longer in the doc → delete (and
 *     cascade-deletes its review rows).
 */
export async function reconcileFlashcards(
  tx: Tx,
  input: {
    pageId: string;
    workspaceId: string;
    userId: string;
    content: unknown;
  },
): Promise<void> {
  const blocks = extractFlashcardBlocks(input.content);
  for (const b of blocks) {
    await upsertCard(tx as never, {
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      blockId: b.blockId,
      front: b.front,
      back: b.back,
      deckTag: b.deckTag,
      createdBy: input.userId,
    });
  }
  const liveBlockIds = blocks.map((b) => b.blockId);
  if (liveBlockIds.length === 0) {
    await tx
      .delete(schema.flashcardCards)
      .where(eq(schema.flashcardCards.pageId, input.pageId));
  } else {
    await tx
      .delete(schema.flashcardCards)
      .where(
        and(
          eq(schema.flashcardCards.pageId, input.pageId),
          notInArray(schema.flashcardCards.blockId, liveBlockIds),
        ),
      );
  }
}
