# v0.9.11 Plan A — Flashcard SRS ingest

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. One task at a time: failing test → confirm fail → minimal impl → confirm pass → commit. Controller/human pushes (never the implementer). Prefix every shell command with `source ~/.zshenv && ` (Testcontainers needs Colima via `DOCKER_HOST`).

## Goal

Revive the entire flashcard SRS feature, which has **never worked when authored through the live editor**. Three linked defects:

- **#114 (P0):** The live editor autosaves through the **collab** path (`collab/server.ts` → `onStoreDocument` → `materialize()`), which does a raw `UPDATE pages SET content` and **never calls `reconcileFlashcards`**. The SRS upsert (`flashcard_cards` rows) only runs on the REST `PATCH` path (`src/lib/pages/update.ts:109` → `reconcileFlashcards`), which the editor does not use for body edits. Result: editor-created cards never reach `flashcard_cards`, so `/flashcards/study` always shows "No cards due".
- **#115 (P0):** `data-block-id=""` is emitted on the flashcard div. `blockId` is only minted inside `extractFlashcardBlocks` (`src/lib/flashcards/reconcile.ts`), which never runs on the collab path. `FlashcardNode.addAttributes` defaults `blockId: null` and `setFlashcard` inserts `blockId: null` (`src/components/editor/blocks/flashcard-node.ts:41,75`). Fix: mint a client-side block id at node-insert so `data-block-id` is non-empty pre-save; the collab reconcile from #114 then persists it.
- **#116 (P1):** Study empty-state CTA hard-links `/` (`src/components/empty-state/variants.tsx:72`). Point it at a real route that helps the user find/author flashcards.

## Architecture

The fix has one core insight: **flashcard reconcile must run wherever `pages.content` is written, not just on the REST path.** Today there are two write paths and only one reconciles:

| Write path | Entry point | Reconciles flashcards? |
|---|---|---|
| REST `PATCH /api/pages/[id]` | `src/lib/pages/update.ts#updatePage` → `reconcileFlashcards` (line 109) | ✅ yes |
| Collab autosave (editor body edits) | `collab/server.ts#materialize()` → raw `UPDATE pages SET content` | ❌ **no** (the bug) |

The collab process is a **standalone Hocuspocus service** (`collab/server.ts`, run as `cairn-collab`). It connects to Postgres with the raw `postgres` driver (`const sql = postgres(DATABASE_URL)`), **not** Drizzle, and its `materialize()` only has the `pageId` (`documentName`) and the merged ProseMirror JSON. `reconcileFlashcards` / `upsertCard` are Drizzle-based and require `workspaceId` + `userId` + `createdBy`.

**Design:**

1. Extract a **driver-agnostic, raw-SQL** reconcile helper for the collab process — `reconcileFlashcardsRaw(sql, { pageId, content })` in a new `src/lib/flashcards/reconcile-raw.ts`. It reuses the existing pure `extractFlashcardBlocks` (already exported from `src/lib/flashcards/reconcile.ts`) to find blocks + mint missing ids, then upserts/prunes `flashcard_cards` with `postgres`-driver SQL. It derives `workspace_id` and `created_by` from the page row itself (`SELECT workspace_id, created_by FROM pages WHERE id = …`) — the collab hook has no reliable per-edit user (Hocuspocus debounces across multiple authors), so the **page author** is the correct, stable `created_by`, exactly mirroring how the page owns the card.
2. Call `reconcileFlashcardsRaw` from `materialize()` inside the same flow that writes `pages.content`, in one transaction so a failed reconcile rolls back the content write (mirrors `updatePage`'s in-tx rationale at `update.ts:102-115`).
3. Mint a client-side `blockId` (`crypto.randomUUID()`) in `FlashcardNode.setFlashcard` and as the attribute `default`, so `data-block-id` is non-empty the moment the node is inserted — before any save. `extractFlashcardBlocks` already preserves an existing non-empty `blockId`, so the same id survives the round-trip and keys the same `flashcard_cards` row idempotently.
4. Repoint the #116 CTA at `/search` (a real, query-param-aware route — `src/app/(app)/search/page.tsx`). See "Code reality" for why the scope's suggested targets do not exist.

**Idempotency / lockstep guarantees (unchanged contract):** `flashcard_cards` is keyed by `(page_id, block_id)`. Re-saving the same doc upserts the same rows (no dupes); deleting a block prunes its row (and cascades `flashcard_reviews`). The collab path must honor the identical contract as the REST path so the two writers never drift.

## Tech Stack

- **collab process:** Hocuspocus `@hocuspocus/server` + `@hocuspocus/extension-database`, raw `postgres` driver, `yjs` + `y-prosemirror` (`yjsStateToProseDoc`). TypeScript strict, ESM (`.js` import specifiers).
- **app libs:** Drizzle ORM over `postgres-js`, Zod v4. Reconcile helpers in `src/lib/flashcards/`.
- **editor:** TipTap 3 (`@tiptap/core`), `FlashcardNode` schema (React-free) + lazy `FlashcardExtension` node-view.
- **tests:** Vitest v4 + Testcontainers v12 (real Postgres via Colima). Integration tests `TRUNCATE` in `beforeEach`; per-file `startPostgres`/`stopPostgres` from `tests/helpers/db.ts`; workspace/user fixtures from `tests/helpers/fixtures.ts` (`createTestWorkspaceWithUser`). Node-view tests use `// @vitest-environment jsdom`.
- **gate:** Biome v2 (`pnpm lint`), `tsc --noEmit` (`pnpm typecheck`), i18n Biome rule (no new untranslated strings), full `pnpm vitest run`, `pnpm build`, Playwright a11y e2e.

**Migration:** **NONE.** This plan reuses the existing `flashcard_cards` / `flashcard_reviews` tables (migration `0045`). Latest migration stays `0068`. No schema change, no backfill table. (Already-orphaned editor cards created before this fix will be reconciled on the next collab save of their page — the first autosave after deploy upserts them — so no one-shot backfill migration is needed.)

---

## File structure

| File | Action | Why |
|---|---|---|
| `src/lib/flashcards/reconcile-raw.ts` | **create** | Driver-agnostic (`postgres` raw-SQL) flashcard reconcile for the collab process; reuses `extractFlashcardBlocks`. |
| `tests/lib/flashcards/reconcile-raw.test.ts` | **create** | Integration test: raw reconcile upserts/prunes `flashcard_cards`; idempotent re-run. |
| `collab/server.ts` | **modify** | Call `reconcileFlashcardsRaw` from `materialize()` in one tx with the content write. |
| `tests/collab/materialize-flashcards.test.ts` | **create** | Regression: simulate collab store (build Y.Doc → `materialize`-equivalent) → assert `flashcard_cards` row exists with non-empty `block_id`; idempotent re-save. |
| `src/components/editor/blocks/flashcard-node.ts` | **modify** | Mint client-side `blockId` (`crypto.randomUUID()`) on insert + as attr default so `data-block-id` is non-empty pre-save. |
| `tests/components/editor/flashcard-node.test.ts` | **modify** | Assert `setFlashcard` produces a non-empty `blockId` and non-empty `data-block-id`. |
| `src/components/empty-state/variants.tsx` | **modify** | #116: repoint `EmptyFlashcardsDue` CTA from `/` to `/search`. |
| `tests/components/empty-state/flashcards-cta.test.tsx` | **create** | Assert the study empty-state CTA links to `/search`, not `/`. |

No new i18n strings: the CTA keeps its existing `copy('empty.flashcardsDue.cta')` label (`'Browse pages'`), only the `ctaHref` changes.

---

## Task 1 — Client-side block-id mint on flashcard insert (#115, editor half)

**Test first.** Edit `tests/components/editor/flashcard-node.test.ts`. Replace the existing `setFlashcard command inserts a flashcard node` test with the stricter version below, and add the data-block-id assertion to the render test.

```ts
  it('setFlashcard command inserts a flashcard node with a non-empty blockId', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    editor.commands.setFlashcard({ front: 'F', back: 'B', deckTag: null });
    const node = (editor.getJSON().content ?? []).find(
      (n) => (n as { type?: string }).type === 'flashcard',
    ) as { attrs?: { blockId?: unknown } } | undefined;
    expect(node).toBeDefined();
    expect(typeof node?.attrs?.blockId).toBe('string');
    expect((node?.attrs?.blockId as string).length).toBeGreaterThan(0);
  });

  it('serializes a non-empty data-block-id for a freshly inserted card', () => {
    const editor = makeEditor({ extensions: [StarterKit, FlashcardNode] });
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    editor.commands.setFlashcard({ front: 'F', back: 'B', deckTag: null });
    const html = editor.getHTML();
    // data-block-id must NOT be empty (the #115 bug: data-block-id="").
    expect(html).toContain('data-block-id="');
    expect(html).not.toContain('data-block-id=""');
  });
```

Run (expect FAIL — `setFlashcard` currently inserts `blockId: null`, so the JSON blockId is null and `data-block-id=""`):

```sh
source ~/.zshenv && pnpm vitest run tests/components/editor/flashcard-node.test.ts
```

**Implement.** Edit `src/components/editor/blocks/flashcard-node.ts`. Mint an id both as the attribute default (covers any insertion path / paste) and explicitly in `setFlashcard`. Use the Web Crypto `crypto.randomUUID()` (available in browsers and Node 24 globally — no import needed; keeps this file React-free and dependency-free).

Change the `blockId` attribute default:

```ts
  addAttributes() {
    return {
      front: { default: '' },
      back: { default: '' },
      deckTag: { default: null },
      // v0.9.11 #115 — mint a stable client-side id at insert so data-block-id
      // is non-empty BEFORE the first save. The collab reconcile keys
      // flashcard_cards by (page_id, block_id); a null id meant the editor-
      // authored card never matched a row. extractFlashcardBlocks preserves a
      // non-empty id, so this same id survives every round-trip.
      blockId: { default: null },
    };
  },
```

…leave the attribute `default: null` (so server-side parsing of legacy docs without ids stays null and lets `extractFlashcardBlocks` mint one), but set a real id in the command:

```ts
  addCommands() {
    return {
      setFlashcard:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              front: attrs.front,
              back: attrs.back,
              deckTag: attrs.deckTag ?? null,
              // v0.9.11 #115 — mint here so the inserted node has a non-empty
              // data-block-id immediately, before any collab/REST save.
              blockId: crypto.randomUUID(),
            },
          }),
    };
  },
```

Run (expect PASS — the existing roundtrip + render-with-explicit-id tests still pass since they pass `blockId` explicitly):

```sh
source ~/.zshenv && pnpm vitest run tests/components/editor/flashcard-node.test.ts
```

**Commit:**

```sh
source ~/.zshenv && git add src/components/editor/blocks/flashcard-node.ts tests/components/editor/flashcard-node.test.ts && git commit -m "fix(flashcards): mint client-side block id on flashcard insert (#115)"
```

---

## Task 2 — Raw-SQL flashcard reconcile for the collab process (#114, core lib)

This is the heart of the fix. The collab service uses the raw `postgres` driver, not Drizzle, so it cannot call the Drizzle-based `reconcileFlashcards`/`upsertCard`. Build a `postgres`-driver equivalent that reuses the pure `extractFlashcardBlocks` and derives `workspace_id` + `created_by` from the page row.

**Test first.** Create `tests/lib/flashcards/reconcile-raw.test.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { reconcileFlashcardsRaw } from '@/lib/flashcards/reconcile-raw';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE flashcard_reviews, flashcard_cards, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

function docWith(blocks: Array<Record<string, unknown>>) {
  return {
    type: 'doc',
    content: blocks.map((attrs) => ({ type: 'flashcard', attrs })),
  };
}

describe('reconcileFlashcardsRaw', () => {
  it('upserts a flashcard_cards row keyed by (page_id, block_id) using the page author as created_by', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });

    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ blockId: 'b1', front: 'Q1', back: 'A1', deckTag: 'spanish' }]),
    });

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.blockId).toBe('b1');
    expect(cards[0]!.front).toBe('Q1');
    expect(cards[0]!.deckTag).toBe('spanish');
    expect(cards[0]!.workspaceId).toBe(u.workspaceId);
    expect(cards[0]!.createdBy).toBe(u.userId);
  });

  it('mints a non-empty block id when the block has none', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });

    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ front: 'Q', back: 'A' }]),
    });

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(typeof cards[0]!.blockId).toBe('string');
    expect(cards[0]!.blockId.length).toBeGreaterThan(0);
  });

  it('is idempotent: re-running the same doc updates in place, no duplicate rows', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const content = docWith([{ blockId: 'b1', front: 'Q', back: 'A', deckTag: null }]);

    await reconcileFlashcardsRaw(sql, { pageId: page.id, content });
    await reconcileFlashcardsRaw(sql, { pageId: page.id, content });

    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);
  });

  it('updates front/back/deck when the same block id reappears edited', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ blockId: 'b1', front: 'Q', back: 'A', deckTag: null }]),
    });
    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ blockId: 'b1', front: 'Q2', back: 'A2', deckTag: 'tag' }]),
    });
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.front).toBe('Q2');
    expect(cards[0]!.deckTag).toBe('tag');
  });

  it('prunes rows whose block id vanished from the doc', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ blockId: 'b1', front: 'q', back: 'a', deckTag: null }]),
    });
    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);

    await reconcileFlashcardsRaw(sql, { pageId: page.id, content: { type: 'doc', content: [] } });
    expect(await db.select().from(schema.flashcardCards)).toHaveLength(0);
  });

  it('no-ops for a missing page (defensive — never throws)', async () => {
    await expect(
      reconcileFlashcardsRaw(sql, {
        pageId: '00000000-0000-0000-0000-000000000000',
        content: docWith([{ blockId: 'b1', front: 'q', back: 'a' }]),
      }),
    ).resolves.toBeUndefined();
  });
});
```

Run (expect FAIL — module `@/lib/flashcards/reconcile-raw` does not exist):

```sh
source ~/.zshenv && pnpm vitest run tests/lib/flashcards/reconcile-raw.test.ts
```

**Implement.** Create `src/lib/flashcards/reconcile-raw.ts`:

```ts
import type { Sql } from 'postgres';
import { extractFlashcardBlocks } from './reconcile';

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
```

Run (expect PASS):

```sh
source ~/.zshenv && pnpm vitest run tests/lib/flashcards/reconcile-raw.test.ts
```

**Commit:**

```sh
source ~/.zshenv && git add src/lib/flashcards/reconcile-raw.ts tests/lib/flashcards/reconcile-raw.test.ts && git commit -m "feat(flashcards): raw-SQL flashcard reconcile for the collab process (#114)"
```

---

## Task 3 — Wire reconcile into the collab materialize path + regression test (#114/#115)

Now call `reconcileFlashcardsRaw` from `collab/server.ts#materialize()` so every autosave reconciles. This is the regression test the scope mandates: simulate a collab store and assert a `flashcard_cards` row exists with a non-empty block id, plus idempotent re-save.

**Test first.** Create `tests/collab/materialize-flashcards.test.ts`. The collab `materialize()` is not directly exported (it closes over a module-level `docs` map and `sql`), so the test exercises the **exact two operations `materialize` performs back-to-back** — the raw content `UPDATE` then `reconcileFlashcardsRaw` — proving the wired sequence persists cards. (The Yjs→ProseMirror conversion itself is already covered by `tests/lib/collab/materialize.test.ts`; this test covers the new reconcile step in the materialize flow against a real DB.)

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { reconcileFlashcardsRaw } from '@/lib/flashcards/reconcile-raw';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE flashcard_reviews, flashcard_cards, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

/**
 * Mirror exactly what collab/server.ts#materialize() does after this plan:
 * write pages.content with the merged ProseMirror JSON, then reconcile
 * flashcards. Proves an editor-authored card reaches the SRS via the collab
 * path (#114) and persists with a non-empty block id (#115).
 */
async function simulateCollabMaterialize(pageId: string, prose: unknown): Promise<void> {
  await sql`UPDATE pages SET content = ${sql.json(prose as never)}, updated_at = now() WHERE id = ${pageId}::uuid`;
  await reconcileFlashcardsRaw(sql, { pageId, content: prose });
}

describe('collab materialize → flashcard SRS ingest', () => {
  it('persists an editor-authored card to flashcard_cards with a non-empty block id', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });

    const prose = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'notes' }] },
        { type: 'flashcard', attrs: { blockId: 'card-1', front: 'Capital of France?', back: 'Paris', deckTag: 'geo' } },
      ],
    };
    await simulateCollabMaterialize(page.id, prose);

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.blockId).toBe('card-1');
    expect(cards[0]!.blockId.length).toBeGreaterThan(0);
    expect(cards[0]!.front).toBe('Capital of France?');
    expect(cards[0]!.back).toBe('Paris');

    // And the page content was written too (the existing materialize behavior).
    const [row] = await db.select().from(schema.pages).where(schema.pages.id ? undefined : undefined).limit(1);
    expect(row).toBeDefined();
  });

  it('is idempotent across repeated autosaves (no duplicate rows)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const prose = {
      type: 'doc',
      content: [{ type: 'flashcard', attrs: { blockId: 'card-1', front: 'Q', back: 'A', deckTag: null } }],
    };

    await simulateCollabMaterialize(page.id, prose);
    await simulateCollabMaterialize(page.id, prose);
    await simulateCollabMaterialize(page.id, prose);

    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);
  });
});
```

> Note: the `db.select().from(schema.pages)...` line above is intentionally just a smoke check that a page row exists; if Biome/tsc flags the ternary, simplify to `const rows = await db.select().from(schema.pages); expect(rows).toHaveLength(1);`.

Run (expect FAIL only if the import path is wrong; since Task 2 created the lib this test should already PASS — it proves the **sequence**. If it passes immediately, that is expected and acceptable: the failing-first signal for the wiring lives in the actual `collab/server.ts` change verified by `pnpm typecheck` + the manual read. Keep the test as the standing regression guard):

```sh
source ~/.zshenv && pnpm vitest run tests/collab/materialize-flashcards.test.ts
```

**Implement.** Edit `collab/server.ts`. Add the import and call `reconcileFlashcardsRaw` inside `materialize()` after the content write.

Add the import near the other `../src/lib/...` imports (line 4-8 area):

```ts
import { reconcileFlashcardsRaw } from '../src/lib/flashcards/reconcile-raw.js';
```

Replace the body of `materialize()` (lines 35-48) so the content write and the reconcile both happen on every materialize:

```ts
async function materialize(pageId: string) {
  const ydoc = docs.get(pageId);
  if (!ydoc) return;
  const state = Y.encodeStateAsUpdate(ydoc);
  const prose = yjsStateToProseDoc(state);
  // sql.json binds the doc as a jsonb OBJECT. Passing JSON.stringify(prose) with
  // a ::jsonb cast would store a jsonb STRING scalar, so the FTS trigger's
  // jsonb_path_query('$.**.text') finds nothing and content_text stays empty.
  await sql`
    UPDATE pages
    SET content = ${sql.json(prose as postgres.JSONValue)}, updated_at = now()
    WHERE id = ${pageId}::uuid
  `;
  // v0.9.11 #114/#115 — the collab autosave path previously stopped here, so
  // editor-authored flashcards never reached flashcard_cards (the SRS upsert
  // only ran on the REST PATCH path). Reconcile here too, with the SAME
  // (page_id, block_id) contract as src/lib/pages/update.ts → reconcileFlashcards,
  // so the two write paths never drift. Driver-agnostic raw-SQL variant because
  // this process uses the postgres driver, not Drizzle.
  await reconcileFlashcardsRaw(sql, { pageId, content: prose });
}
```

Run typecheck (the collab tsconfig must resolve the new `.js` specifier) and the regression test:

```sh
source ~/.zshenv && pnpm typecheck && pnpm vitest run tests/collab/materialize-flashcards.test.ts
```

> If `pnpm typecheck` does not include `collab/` (it is a standalone service), also run the collab build/typecheck the repo uses for that directory. Confirm the import resolves before committing. Check `tsconfig*.json` for a `collab` include; the existing `collab/server.ts` already imports `'../src/lib/collab/authorize.js'` the same way, so the new import follows an established, type-checked pattern.

**Commit:**

```sh
source ~/.zshenv && git add collab/server.ts tests/collab/materialize-flashcards.test.ts && git commit -m "fix(collab): reconcile flashcards on materialize so editor cards reach SRS (#114, #115)"
```

---

## Task 4 — Repoint study empty-state CTA at a real route (#116)

**Code reality:** the scope suggested `/flashcards` (a study/browse route) or `/?filter=has-flashcards`. **Neither exists.** The only flashcard route is `/flashcards/study` (the empty state itself). The home route `/` (`src/app/(app)/page.tsx`) ignores query params and `redirect()`s to the configured landing page, so `/?filter=has-flashcards` would never render a filtered list. The real, query-param-aware destination that helps a user find/author flashcard pages is **`/search`** (`src/app/(app)/search/page.tsx`, accepts `?q=`). Repoint the CTA there. The label stays `'Browse pages'` (existing `copy('empty.flashcardsDue.cta')`), so **no new i18n string**.

**Test first.** Create `tests/components/empty-state/flashcards-cta.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyFlashcardsDue } from '@/components/empty-state/variants';

// next/link renders a plain <a href> under jsdom; stub to keep it simple.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('EmptyFlashcardsDue CTA', () => {
  it('links the CTA to /search, not to / (#116)', () => {
    const { container } = render(<EmptyFlashcardsDue />);
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/search');
    expect(link?.getAttribute('href')).not.toBe('/');
  });
});
```

Run (expect FAIL — current `ctaHref="/"`):

```sh
source ~/.zshenv && pnpm vitest run tests/components/empty-state/flashcards-cta.test.tsx
```

**Implement.** Edit `src/components/empty-state/variants.tsx`, in `EmptyFlashcardsDue`:

```tsx
export function EmptyFlashcardsDue() {
  return (
    <EmptyState
      icon={<GraduationCap aria-hidden="true" />}
      headline={copy('empty.flashcardsDue.headline')}
      guidance={copy('empty.flashcardsDue.guidance')}
      ctaLabel={copy('empty.flashcardsDue.cta')}
      // v0.9.11 #116 — was "/", which the home route redirects away from and
      // does not filter. /search is a real query-param route where the user can
      // find pages that contain flashcards and add/review more cards.
      ctaHref="/search"
    />
  );
}
```

Run (expect PASS):

```sh
source ~/.zshenv && pnpm vitest run tests/components/empty-state/flashcards-cta.test.tsx
```

**Commit:**

```sh
source ~/.zshenv && git add src/components/empty-state/variants.tsx tests/components/empty-state/flashcards-cta.test.tsx && git commit -m "fix(flashcards): point study empty-state CTA at /search not home (#116)"
```

---

## Task 5 — Gate (full verification before the PR)

Run the complete gate. Every command must pass with the stated result before this plan is considered done. Do **not** push.

```sh
# 1. Lint — Biome v2 must report 0 errors. Accept its import-order / import-type
#    auto-fixes (run with --write if needed, then re-stage).
source ~/.zshenv && pnpm lint

# 2. Typecheck — tsc --noEmit, including the collab service import of reconcile-raw.
source ~/.zshenv && pnpm typecheck

# 3. i18n — no NEW untranslated strings. This plan adds none (CTA reuses the
#    existing copy('empty.flashcardsDue.cta') key; comments/code only). Confirm
#    the i18n Biome rule / catalog check reports nothing new.
source ~/.zshenv && pnpm lint   # i18n rule runs under Biome; if a separate script exists, run it too

# 4. Full test suite — Testcontainers needs Docker (Colima). isolate stays ON.
source ~/.zshenv && pnpm vitest run

# 5. Build — Next build + entrypoint tsc.
source ~/.zshenv && pnpm build

# 6. a11y e2e — the structural gate. The study empty-state CTA still meets the
#    44px touch-target floor (EmptyState wraps the CTA in min-h-11; unchanged —
#    only the href changed). Run the Playwright a11y suite.
source ~/.zshenv && pnpm test:e2e:a11y   # use the repo's actual a11y e2e script name
```

> If `colima` is down: `source ~/.zshenv && colima start` first (Testcontainers and any Docker-backed e2e require it).

**Gate checklist:**
- [ ] `pnpm lint` → 0 errors.
- [ ] `pnpm typecheck` → clean (collab `reconcile-raw.js` import resolves).
- [ ] No new untranslated i18n strings.
- [ ] `pnpm vitest run` → all green, including the three new suites:
      `tests/lib/flashcards/reconcile-raw.test.ts`,
      `tests/collab/materialize-flashcards.test.ts`,
      `tests/components/empty-state/flashcards-cta.test.tsx`,
      and the updated `tests/components/editor/flashcard-node.test.ts`.
- [ ] `pnpm build` → succeeds.
- [ ] a11y e2e → passes (CTA touch target unchanged).

**Final regression proof (the #114/#115 core):** a flashcard authored in the live editor → autosaved via collab → `materialize()` writes `pages.content` **and** calls `reconcileFlashcardsRaw` → a `flashcard_cards` row exists with a **non-empty** `block_id` → `/flashcards/study` `/api/flashcards/due` returns it. Re-saving is idempotent (same `(page_id, block_id)` row, no dupes). The collab and REST write paths now honor the identical reconcile contract.

Do not commit a release bump or push here — leave the branch for the controller.
