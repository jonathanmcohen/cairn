import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDeck } from '@/lib/flashcards/decks';
import { moveToDeck } from '@/lib/flashcards/manage';
import { upsertCard } from '@/lib/flashcards/upsert-card';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

// Route responses are JSON the routes shape loosely; tests cast as needed.
// biome-ignore lint/suspicious/noExplicitAny: test-only loose response body
type BodyVal = any;

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE audit_log, flashcard_reviews, flashcard_cards, flashcard_decks, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/require-role', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/require-role')>('@/lib/auth/require-role');
  let ctx: { userId: string; workspaceId: string | null; role: schema.MemberRole | null } | null =
    null;
  return {
    ...actual,
    getAuthContext: async () => ctx,
    __set: (
      next: { userId: string; workspaceId: string | null; role: schema.MemberRole | null } | null,
    ) => {
      ctx = next;
    },
  };
});

async function setActor(
  c: { userId: string; workspaceId: string; role: schema.MemberRole } | null,
): Promise<void> {
  const mod = (await import('@/lib/auth/require-role')) as unknown as {
    __set: (
      c: { userId: string; workspaceId: string | null; role: schema.MemberRole | null } | null,
    ) => void;
  };
  mod.__set(c);
}

async function callList(query = ''): Promise<{ status: number; body: BodyVal }> {
  const mod = await import('@/app/api/flashcards/manage/route');
  const res = await mod.GET(new Request(`http://localhost/api/flashcards/manage${query}`));
  const ct = res.headers.get('content-type') ?? '';
  return {
    status: res.status,
    body: ct.includes('json') ? await res.json() : await res.text(),
  };
}

async function callBulk(body: unknown): Promise<{ status: number; body: BodyVal }> {
  const mod = await import('@/app/api/flashcards/manage/bulk/route');
  const res = await mod.POST(
    new Request('http://localhost/api/flashcards/manage/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function callPatchCard(
  cardId: string,
  body: unknown,
): Promise<{ status: number; body: BodyVal }> {
  const mod = await import('@/app/api/flashcards/[cardId]/route');
  const res = await mod.PATCH(
    new Request(`http://localhost/api/flashcards/${cardId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ cardId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function callDeleteCard(cardId: string): Promise<{ status: number; body: BodyVal }> {
  const mod = await import('@/app/api/flashcards/[cardId]/route');
  const res = await mod.DELETE(new Request(`http://localhost/api/flashcards/${cardId}`), {
    params: Promise.resolve({ cardId }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function fixture() {
  const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
  const page = await createPage(getDb(), {
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    title: 'Source',
  });
  const mk = (blockId: string, front: string, back = `A-${front}`) =>
    upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId,
      front,
      back,
      deckTag: null,
      createdBy: u.userId,
    });
  return { u, page, mk };
}

describe('GET /api/flashcards/manage', () => {
  it('rejects unauthenticated', async () => {
    await setActor(null);
    expect((await callList()).status).toBe(401);
  });

  it('lists cards with deck/source/state and filters by search + deck', async () => {
    const { u, mk } = await fixture();
    const deck = await createDeck(getDb(), u.workspaceId, 'D1');
    const c1 = await mk('b1', 'hola');
    await mk('b2', 'adios');
    await moveToDeck(getDb(), u.workspaceId, [c1.id], deck.id);
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    const all = await callList();
    expect(all.status).toBe(200);
    expect(all.body.cards).toHaveLength(2);

    const byDeck = await callList(`?deck=${deck.id}`);
    expect(byDeck.body.cards).toHaveLength(1);
    expect(byDeck.body.cards[0].front).toBe('hola');
    expect(byDeck.body.cards[0].deckName).toBe('D1');

    const bySearch = await callList('?search=adios');
    expect(bySearch.body.cards).toHaveLength(1);
    expect(bySearch.body.cards[0].front).toBe('adios');
  });

  it('exports selected cards as CSV', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'csvfront');
    await mk('b2', 'other');
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const res = await callList(`?format=csv&ids=${c1.id}`);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    expect(res.body).toContain('front,back,deck');
    expect(res.body).toContain('csvfront');
    expect(res.body).not.toContain('other');
  });
});

describe('POST /api/flashcards/manage/bulk', () => {
  it('moves cards to a deck and adds tags', async () => {
    const { u, mk } = await fixture();
    const deck = await createDeck(getDb(), u.workspaceId, 'Move');
    const c1 = await mk('b1', 'x');
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    expect(
      (await callBulk({ action: 'moveToDeck', cardIds: [c1.id], deckId: deck.id })).status,
    ).toBe(200);
    expect((await callBulk({ action: 'addTags', cardIds: [c1.id], tags: ['noun'] })).status).toBe(
      200,
    );
    const [row] = await getDb()
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, c1.id));
    expect(row!.deckId).toBe(deck.id);
    expect(row!.tags).toContain('noun');
  });

  it('suspends + resets and records an audit row for reset', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'x');
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    // Seed a review row so reset has something to zero out.
    await getDb().insert(schema.flashcardReviews).values({
      cardId: c1.id,
      userId: u.userId,
      ease: 2.9,
      interval: 30,
      reps: 5,
      dueAt: new Date(),
    });

    expect((await callBulk({ action: 'suspend', cardIds: [c1.id] })).status).toBe(200);
    const [suspended] = await getDb()
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, c1.id));
    expect(suspended!.suspendedAt).not.toBeNull();

    expect((await callBulk({ action: 'reset', cardIds: [c1.id] })).status).toBe(200);
    const [review] = await getDb()
      .select()
      .from(schema.flashcardReviews)
      .where(
        and(
          eq(schema.flashcardReviews.cardId, c1.id),
          eq(schema.flashcardReviews.userId, u.userId),
        ),
      );
    expect(review!.interval).toBe(0);
    expect(review!.reps).toBe(0);
    expect(review!.ease).toBeCloseTo(2.5);

    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'flashcard.reset'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.workspaceId).toBe(u.workspaceId);
  });

  it('bulk-delete returns a snapshot; restore brings the card AND its reviews back', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'doomed');
    await getDb()
      .insert(schema.flashcardReviews)
      .values({
        cardId: c1.id,
        userId: u.userId,
        ease: 2.7,
        interval: 12,
        reps: 4,
        dueAt: new Date('2026-07-01T00:00:00.000Z'),
      });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    const del = await callBulk({ action: 'delete', cardIds: [c1.id] });
    expect(del.status).toBe(200);
    expect(del.body.count).toBe(1);
    expect(del.body.snapshot).toHaveLength(1);
    // Gone (card + cascaded review).
    expect(
      await getDb().select().from(schema.flashcardCards).where(eq(schema.flashcardCards.id, c1.id)),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(schema.flashcardReviews)
        .where(eq(schema.flashcardReviews.cardId, c1.id)),
    ).toHaveLength(0);

    // Delete audit recorded.
    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'flashcard.deleted'));
    expect(audits).toHaveLength(1);

    // Undo: re-POST the snapshot through `restore`.
    const restore = await callBulk({ action: 'restore', snapshot: del.body.snapshot });
    expect(restore.status).toBe(200);
    expect(restore.body.count).toBe(1);

    const [card] = await getDb()
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, c1.id));
    expect(card!.front).toBe('doomed');
    const [review] = await getDb()
      .select()
      .from(schema.flashcardReviews)
      .where(eq(schema.flashcardReviews.cardId, c1.id));
    expect(review!.interval).toBe(12);
    expect(review!.reps).toBe(4);
    expect(review!.ease).toBeCloseTo(2.7);
  });

  it('restore drops a snapshot whose card belongs to another workspace', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'mine');
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const del = await callBulk({ action: 'delete', cardIds: [c1.id] });
    // Tamper: rewrite the snapshot's workspace to a foreign uuid.
    const tampered = JSON.parse(JSON.stringify(del.body.snapshot));
    tampered[0].card.workspaceId = '00000000-0000-0000-0000-0000000000ff';
    const restore = await callBulk({ action: 'restore', snapshot: tampered });
    expect(restore.status).toBe(200);
    expect(restore.body.count).toBe(0);
  });
});

describe('PATCH /api/flashcards/[cardId]', () => {
  it('edits front/back of an attached card and writes through to the source block', async () => {
    const { u, page, mk } = await fixture();
    const c1 = await mk('blk-1', 'oldFront', 'oldBack');
    // Plant the matching flashcard node in the page content so write-through
    // has a block to patch.
    await getDb()
      .update(schema.pages)
      .set({
        content: {
          type: 'doc',
          content: [
            {
              type: 'flashcard',
              attrs: { blockId: 'blk-1', front: 'oldFront', back: 'oldBack', deckTag: null },
            },
          ],
        },
      })
      .where(eq(schema.pages.id, page.id));
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    const res = await callPatchCard(c1.id, { front: 'newFront', back: 'newBack' });
    expect(res.status).toBe(200);

    // Card row updated (via reconcile from the patched doc).
    const [card] = await getDb()
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, c1.id));
    expect(card!.front).toBe('newFront');
    expect(card!.back).toBe('newBack');

    // Source block in the page content updated too.
    const [pg] = await getDb()
      .select({ content: schema.pages.content })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    const node = (pg!.content as { content: { attrs?: Record<string, unknown> }[] }).content[0]!;
    expect(node.attrs?.front).toBe('newFront');
  });

  it('returns 404 for a card in another workspace', async () => {
    const a = await fixture();
    const card = await a.mk('b1', 'secret');
    const b = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setActor({ userId: b.userId, workspaceId: b.workspaceId, role: 'editor' });
    expect((await callPatchCard(card.id, { front: 'x' })).status).toBe(404);
    expect((await callDeleteCard(card.id)).status).toBe(404);
  });

  it('DELETE removes a single card + records audit + returns a snapshot', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'gone');
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const res = await callDeleteCard(c1.id);
    expect(res.status).toBe(200);
    expect(res.body.snapshot).toHaveLength(1);
    expect(
      await getDb().select().from(schema.flashcardCards).where(eq(schema.flashcardCards.id, c1.id)),
    ).toHaveLength(0);
    const audits = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'flashcard.deleted'));
    expect(audits).toHaveLength(1);
  });
});

describe('flashcards decks API', () => {
  it('creates, lists, and 409s on duplicate deck names', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const decksMod = await import('@/app/api/flashcards/decks/route');

    const create = await decksMod.POST(
      new Request('http://localhost/api/flashcards/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Verbs' }),
      }),
    );
    expect(create.status).toBe(201);

    const dup = await decksMod.POST(
      new Request('http://localhost/api/flashcards/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Verbs' }),
      }),
    );
    expect(dup.status).toBe(409);

    const list = await decksMod.GET();
    const body = (await list.json()) as { decks: { name: string }[] };
    expect(body.decks.some((d) => d.name === 'Verbs')).toBe(true);
  });
});
