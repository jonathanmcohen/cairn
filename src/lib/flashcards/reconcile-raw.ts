import type { Sql } from 'postgres';
import { extractFlashcardBlocks, stampCardIdOnBlock } from './extract';

/**
 * Driver-agnostic flashcard reconcile for the standalone collab process
 * (`collab/server.ts`), which talks to Postgres with the raw `postgres` driver
 * rather than Drizzle and therefore cannot call the Drizzle-based
 * `reconcileFlashcards` / `upsertCard`.
 *
 * Contract is IDENTICAL to `reconcileFlashcards` (src/lib/flashcards/reconcile.ts)
 * so the collab autosave path and the REST PATCH path never drift:
 *   v0.10.2 F2-D — the CARD is canonical, the block is a reference:
 *   - block WITH a resolvable `cardId` → write its front/back into THAT card,
 *     refresh `(page_id, block_id)`, clear `source_orphaned_at`. Deck NOT
 *     touched (managed via the manage/decks UI).
 *   - block WITHOUT a (resolvable) cardId → adopt the legacy `(page_id,
 *     block_id)` row or INSERT a new card (deck = the block's `deckId` hint if
 *     present, else the workspace Default deck). BACKFILL the resolved card id
 *     onto the block.
 *   - any existing card on this page that no live block resolves to (by neither
 *     block id nor card id) → ORPHAN-MARK (set source_orphaned_at = now()), NOT
 *     delete — so the card's flashcard_reviews history survives (v0.10.2 F1).
 *
 * `workspace_id` and `created_by` are derived from the page row itself. The
 * collab hook has no reliable per-edit user (Hocuspocus debounces across
 * multiple authors), so the PAGE AUTHOR is the stable, correct `created_by`
 * — mirroring how flashcard_cards already cascades from the page.
 *
 * Returns `{ contentChanged }`: true iff a cardId was backfilled into `content`
 * (mutated in place) AND `pages.content` was re-persisted here. The caller
 * (materialize) uses this to push the stamped content into the live Y.Doc.
 */
export async function reconcileFlashcardsRaw(
  sql: Sql,
  input: { pageId: string; content: unknown },
): Promise<{ contentChanged: boolean }> {
  // Derive ownership from the page. If the page is gone (race / deleted), no-op.
  const pageRows = await sql<{ workspace_id: string; created_by: string }[]>`
    SELECT workspace_id, created_by FROM pages WHERE id = ${input.pageId}::uuid LIMIT 1
  `;
  const page = pageRows[0];
  if (!page) return { contentChanged: false };

  const blocks = extractFlashcardBlocks(input.content);
  let contentChanged = false;

  await sql.begin(async (tx) => {
    const liveCardIds: string[] = [];
    for (const b of blocks) {
      let resolvedCardId: string | null = null;

      // 1. Resolve by cardId (the canonical reference) when present.
      if (b.cardId) {
        const byId = await tx<{ id: string }[]>`
          SELECT id FROM flashcard_cards
          WHERE id = ${b.cardId}::uuid AND workspace_id = ${page.workspace_id}::uuid
          LIMIT 1
        `;
        if (byId[0]) {
          await tx`
            UPDATE flashcard_cards
            SET front = ${b.front}, back = ${b.back},
                page_id = ${input.pageId}::uuid, block_id = ${b.blockId},
                source_orphaned_at = NULL, updated_at = now()
            WHERE id = ${byId[0].id}::uuid
          `;
          resolvedCardId = byId[0].id;
        }
        // else: cardId did not resolve — fall through to the legacy path.
      }

      // 2. Legacy / new path: look up by (page_id, block_id).
      if (!resolvedCardId) {
        const existing = await tx<{ id: string }[]>`
          SELECT id FROM flashcard_cards
          WHERE page_id = ${input.pageId}::uuid AND block_id = ${b.blockId}
          LIMIT 1
        `;
        if (existing[0]) {
          await tx`
            UPDATE flashcard_cards
            SET front = ${b.front}, back = ${b.back}, deck_tag = ${b.deckTag},
                source_orphaned_at = NULL, updated_at = now()
            WHERE id = ${existing[0].id}::uuid
          `;
          resolvedCardId = existing[0].id;
        } else {
          // INSERT a new card. Deck = the block's hint if present, else the
          // workspace Default deck (created lazily, ON CONFLICT DO NOTHING).
          let deckId = b.deckId;
          if (!deckId) {
            await tx`
              INSERT INTO flashcard_decks (workspace_id, name)
              VALUES (${page.workspace_id}::uuid, 'Default')
              ON CONFLICT (workspace_id, name) DO NOTHING
            `;
            const def = await tx<{ id: string }[]>`
              SELECT id FROM flashcard_decks
              WHERE workspace_id = ${page.workspace_id}::uuid AND name = 'Default'
              LIMIT 1
            `;
            deckId = def[0]?.id ?? null;
          }
          const inserted = await tx<{ id: string }[]>`
            INSERT INTO flashcard_cards
              (page_id, workspace_id, block_id, front, back, deck_tag, deck_id, created_by)
            VALUES (
              ${input.pageId}::uuid, ${page.workspace_id}::uuid, ${b.blockId},
              ${b.front}, ${b.back}, ${b.deckTag},
              ${deckId ? sql`${deckId}::uuid` : null}, ${page.created_by}::uuid
            )
            RETURNING id
          `;
          resolvedCardId = inserted[0]?.id ?? null;
        }
      }

      if (resolvedCardId) {
        liveCardIds.push(resolvedCardId);
        // Backfill the resolved card id onto the block (idempotent → converges).
        if (b.cardId !== resolvedCardId) {
          if (stampCardIdOnBlock(input.content, b.blockId, resolvedCardId)) contentChanged = true;
        }
      }
    }

    // Orphan-mark cards on this page that no live block resolves to — by neither
    // block id (refreshed to a live id for resolved cards) nor card id.
    const liveBlockIds = blocks.map((b) => b.blockId);
    if (blocks.length === 0) {
      await tx`
        UPDATE flashcard_cards
        SET source_orphaned_at = now(), updated_at = now()
        WHERE page_id = ${input.pageId}::uuid
          AND source_orphaned_at IS NULL
      `;
    } else {
      await tx`
        UPDATE flashcard_cards
        SET source_orphaned_at = now(), updated_at = now()
        WHERE page_id = ${input.pageId}::uuid
          AND source_orphaned_at IS NULL
          AND block_id <> ALL(${tx.array(liveBlockIds)})
          AND id <> ALL(${tx.array(liveCardIds)}::uuid[])
      `;
    }
  });

  // Persist the backfilled content so the saved jsonb carries the cardId(s).
  // (The materialize() caller already wrote pages.content from the same object
  // BEFORE reconcile, so this re-write applies the in-place cardId stamps.)
  if (contentChanged) {
    // Stringify + ::jsonb cast stores a proper jsonb OBJECT (NOT a jsonb STRING
    // scalar), so the pages FTS trigger's jsonb_path_query('$.**.text') still
    // finds text. (Same approach as the materialize-flashcards path's content
    // write; sql.json's bind wrapper is not used here so the value serializes
    // cleanly through the prepared-statement path.)
    const json = JSON.stringify(input.content);
    await sql`
      UPDATE pages
      SET content = ${json}::jsonb, updated_at = now()
      WHERE id = ${input.pageId}::uuid
    `;
  }

  return { contentChanged };
}
