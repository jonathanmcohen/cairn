import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { runWorkspaceExport } from '@/lib/export/workspace-archive';
import { runImport } from '@/lib/import/run';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let tmpDir: string;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  tmpDir = join(tmpdir(), `cairn-roundtrip-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`TRUNCATE pages, databases, workspaces, users, workspace_members, import_jobs,
    flashcard_decks, flashcard_cards, flashcard_reviews RESTART IDENTITY CASCADE`;
});

describe('workspace export → import round-trip', () => {
  it('exports a workspace and re-imports it into a fresh one with new ids', async () => {
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'u@x.com', passwordHash: 'h', name: 'U' })
      .returning();
    if (!u) throw new Error('no user');
    const [src] = await db
      .insert(schema.workspaces)
      .values({ name: 'Src', slug: 'src' })
      .returning();
    const [dst] = await db
      .insert(schema.workspaces)
      .values({ name: 'Dst', slug: 'dst' })
      .returning();
    if (!src || !dst) throw new Error('no workspaces');
    await db.insert(schema.workspaceMembers).values([
      { workspaceId: src.id, userId: u.id, role: 'owner' },
      { workspaceId: dst.id, userId: u.id, role: 'owner' },
    ]);
    const [page] = await db
      .insert(schema.pages)
      .values({
        workspaceId: src.id,
        title: 'Hello',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'world' }] }],
        },
        createdBy: u.id,
      })
      .returning();
    if (!page) throw new Error('no page');

    const zip = await runWorkspaceExport({ workspaceId: src.id, outDir: tmpDir });
    expect(zip).toMatch(/cairn-export-/);

    const report = await runImport({
      source: 'workspace-archive',
      file: zip,
      workspaceId: dst.id,
      actorUserId: u.id,
    });
    expect(report.counts.pages).toBe(1);

    const dstPages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, dst.id));
    expect(dstPages).toHaveLength(1);
    expect(dstPages[0]!.title).toBe('Hello');
    expect(dstPages[0]!.id).not.toBe(page.id);
  });
});

describe('workspace export → import round-trip (flashcards, F1 Task D)', () => {
  it('restores decks, attached + orphaned cards, and per-user SM-2 state by email', async () => {
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'owner@x.com', passwordHash: 'h', name: 'Owner' })
      .returning();
    // A second user who is NOT a member of the destination workspace — their
    // review rows must be SKIPPED on import (email doesn't resolve).
    const [stranger] = await db
      .insert(schema.users)
      .values({ email: 'stranger@x.com', passwordHash: 'h', name: 'Stranger' })
      .returning();
    if (!u || !stranger) throw new Error('no users');
    const [src] = await db
      .insert(schema.workspaces)
      .values({ name: 'Src', slug: 'src' })
      .returning();
    const [dst] = await db
      .insert(schema.workspaces)
      .values({ name: 'Dst', slug: 'dst' })
      .returning();
    if (!src || !dst) throw new Error('no workspaces');
    await db.insert(schema.workspaceMembers).values([
      { workspaceId: src.id, userId: u.id, role: 'owner' },
      { workspaceId: src.id, userId: stranger.id, role: 'editor' },
      // Only the owner is a member of dst; stranger is not.
      { workspaceId: dst.id, userId: u.id, role: 'owner' },
    ]);

    // A page carrying a flashcard block with a stable block id.
    const BLOCK_ID = 'block-abc-123';
    const [page] = await db
      .insert(schema.pages)
      .values({
        workspaceId: src.id,
        title: 'Studies',
        content: {
          type: 'doc',
          content: [
            {
              type: 'flashcard',
              attrs: { blockId: BLOCK_ID, front: 'Q', back: 'A' },
            },
          ],
        },
        createdBy: u.id,
      })
      .returning();
    if (!page) throw new Error('no page');

    const [deck] = await db
      .insert(schema.flashcardDecks)
      .values({ workspaceId: src.id, name: 'Spanish' })
      .returning();
    if (!deck) throw new Error('no deck');

    // Attached card — matched on import by (restored page id, block id).
    const [attached] = await db
      .insert(schema.flashcardCards)
      .values({
        pageId: page.id,
        workspaceId: src.id,
        blockId: BLOCK_ID,
        front: 'Q',
        back: 'A',
        deckId: deck.id,
        tags: ['verbs'],
        createdBy: u.id,
      })
      .returning();
    // Orphaned/standalone card — no source page.
    const [orphan] = await db
      .insert(schema.flashcardCards)
      .values({
        pageId: null,
        workspaceId: src.id,
        blockId: 'block-orphan-1',
        front: 'OrphanQ',
        back: 'OrphanA',
        deckId: null,
        tags: [],
        sourceOrphanedAt: new Date('2026-01-01T00:00:00Z'),
        createdBy: u.id,
      })
      .returning();
    if (!attached || !orphan) throw new Error('no cards');

    // Review state: owner has SM-2 progress on the attached card; stranger has
    // state too (must be dropped on import, since not a dst member).
    await db.insert(schema.flashcardReviews).values([
      {
        cardId: attached.id,
        userId: u.id,
        ease: 2.6,
        interval: 4,
        reps: 3,
        dueAt: new Date('2026-07-01T00:00:00Z'),
        lastReviewedAt: new Date('2026-06-27T00:00:00Z'),
        lastGrade: 5,
      },
      {
        cardId: attached.id,
        userId: stranger.id,
        ease: 2.5,
        interval: 1,
        reps: 1,
        dueAt: new Date('2026-06-20T00:00:00Z'),
        lastReviewedAt: null,
        lastGrade: 3,
      },
    ]);

    const zip = await runWorkspaceExport({ workspaceId: src.id, outDir: tmpDir });
    await runImport({
      source: 'workspace-archive',
      file: zip,
      workspaceId: dst.id,
      actorUserId: u.id,
    });

    // Decks: Default (ensured) + Spanish (restored).
    const dstDecks = await db
      .select()
      .from(schema.flashcardDecks)
      .where(eq(schema.flashcardDecks.workspaceId, dst.id));
    expect(dstDecks.map((d) => d.name).sort()).toEqual(['Default', 'Spanish']);

    const dstCards = await db
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.workspaceId, dst.id));
    expect(dstCards).toHaveLength(2);

    // Attached card: re-homed to the freshly-minted page, same block id, deck
    // matched by name, tags preserved.
    const restoredAttached = dstCards.find((c) => c.blockId === BLOCK_ID);
    expect(restoredAttached).toBeTruthy();
    expect(restoredAttached!.id).not.toBe(attached.id);
    expect(restoredAttached!.pageId).not.toBeNull();
    expect(restoredAttached!.pageId).not.toBe(page.id);
    expect(restoredAttached!.tags).toEqual(['verbs']);
    const spanishDeck = dstDecks.find((d) => d.name === 'Spanish')!;
    expect(restoredAttached!.deckId).toBe(spanishDeck.id);

    // Orphaned card: page-less, orphan timestamp preserved.
    const restoredOrphan = dstCards.find((c) => c.blockId === 'block-orphan-1');
    expect(restoredOrphan).toBeTruthy();
    expect(restoredOrphan!.pageId).toBeNull();
    expect(restoredOrphan!.sourceOrphanedAt).not.toBeNull();

    // Reviews: only the owner's row survives (member of dst); stranger dropped.
    const dstReviews = await db
      .select()
      .from(schema.flashcardReviews)
      .where(eq(schema.flashcardReviews.cardId, restoredAttached!.id));
    expect(dstReviews).toHaveLength(1);
    expect(dstReviews[0]!.userId).toBe(u.id);
    expect(dstReviews[0]!.reps).toBe(3);
    expect(dstReviews[0]!.ease).toBeCloseTo(2.6);
    expect(dstReviews[0]!.lastGrade).toBe(5);
  });
});
