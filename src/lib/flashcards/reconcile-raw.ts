import type { Sql } from 'postgres';
import { extractFlashcardBlocks } from './extract';

/**
 * Driver-agnostic flashcard reconcile for the standalone collab process
 * (`collab/server.ts`), which talks to Postgres with the raw `postgres` driver
 * rather than Drizzle and therefore cannot call the Drizzle-based
 * `reconcileFlashcards` / `upsertCard`.
 *
 * Contract is IDENTICAL to `reconcileFlashcards` (src/lib/flashcards/reconcile.ts)
 * so the collab autosave path and the REST PATCH path never drift:
 *   - every `flashcard` block in the doc → upsert into flashcard_cards keyed by
 *     (page_id, block_id);
 *   - any existing card whose block id is no longer in the doc → delete (its
 *     flashcard_reviews cascade away via the FK).
 *
 * `workspace_id` and `created_by` are derived from the page row itself. The
 * collab hook has no reliable per-edit user (Hocuspocus debounces across
 * multiple authors), so the PAGE AUTHOR is the stable, correct `created_by`
 * — mirroring how flashcard_cards already cascades from the page.
 *
 * v0.9.11 #114: the missing piece — the collab `materialize()` wrote
 * pages.content but never reconciled, so editor-authored cards never reached
 * the SRS. Reuses the pure `extractFlashcardBlocks` (which mints ids for blocks
 * that lack one).
 */
export async function reconcileFlashcardsRaw(
  sql: Sql,
  input: { pageId: string; content: unknown },
): Promise<void> {
  // Derive ownership from the page. If the page is gone (race / deleted), no-op.
  const pageRows = await sql<{ workspace_id: string; created_by: string }[]>`
    SELECT workspace_id, created_by FROM pages WHERE id = ${input.pageId}::uuid LIMIT 1
  `;
  const page = pageRows[0];
  if (!page) return;

  const blocks = extractFlashcardBlocks(input.content);

  await sql.begin(async (tx) => {
    for (const b of blocks) {
      // Upsert keyed by (page_id, block_id). There is no unique constraint on
      // that pair (only an index), so emulate upsert with an existence check —
      // matching the Drizzle upsertCard behavior exactly.
      const existing = await tx<{ id: string }[]>`
        SELECT id FROM flashcard_cards
        WHERE page_id = ${input.pageId}::uuid AND block_id = ${b.blockId}
        LIMIT 1
      `;
      if (existing[0]) {
        await tx`
          UPDATE flashcard_cards
          SET front = ${b.front}, back = ${b.back}, deck_tag = ${b.deckTag}, updated_at = now()
          WHERE id = ${existing[0].id}::uuid
        `;
      } else {
        await tx`
          INSERT INTO flashcard_cards
            (page_id, workspace_id, block_id, front, back, deck_tag, created_by)
          VALUES (
            ${input.pageId}::uuid, ${page.workspace_id}::uuid, ${b.blockId},
            ${b.front}, ${b.back}, ${b.deckTag}, ${page.created_by}::uuid
          )
        `;
      }
    }

    // Prune cards whose block id is no longer present in the doc.
    const liveIds = blocks.map((b) => b.blockId);
    if (liveIds.length === 0) {
      await tx`DELETE FROM flashcard_cards WHERE page_id = ${input.pageId}::uuid`;
    } else {
      await tx`
        DELETE FROM flashcard_cards
        WHERE page_id = ${input.pageId}::uuid
          AND block_id <> ALL(${tx.array(liveIds)})
      `;
    }
  });
}
