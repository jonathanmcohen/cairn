import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { proposeSuggestion } from '@/lib/suggestions/index-sync';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser, type TestUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE suggestions, comments, db_cells, db_rows, db_properties, databases, files, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setActor(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

async function seedPage(user: TestUser): Promise<string> {
  const page = await createPage(getDb(), {
    workspaceId: user.workspaceId,
    createdBy: user.userId,
  });
  return page.id;
}

async function callList(method: 'GET' | 'POST', pageId: string, body?: unknown) {
  const mod = await import('@/app/api/pages/[pageId]/suggestions/route');
  const handler = mod[method] as (
    req: Request,
    ctx: { params: Promise<{ pageId: string }> },
  ) => Promise<Response>;
  const res = await handler(
    new Request(`http://localhost/api/pages/${pageId}/suggestions`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function callResolve(pageId: string, suggestionId: string, body: unknown) {
  const mod = await import('@/app/api/pages/[pageId]/suggestions/[suggestionId]/route');
  const handler = mod.POST as (
    req: Request,
    ctx: { params: Promise<{ pageId: string; suggestionId: string }> },
  ) => Promise<Response>;
  const res = await handler(
    new Request(`http://localhost/api/pages/${pageId}/suggestions/${suggestionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ pageId, suggestionId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('/api/pages/[pageId]/suggestions', () => {
  it('viewer cannot propose → 403', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const pageId = await seedPage(u);
    await setActor(u.userId);
    const r = await callList('POST', pageId);
    expect(r.status).toBe(403);
  });

  it('editor proposes → 201 + suggestionId, then GET lists it', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const pageId = await seedPage(u);
    await setActor(u.userId);

    const post = await callList('POST', pageId);
    expect(post.status).toBe(201);
    const { suggestionId } = post.body as { suggestionId: string };
    expect(typeof suggestionId).toBe('string');

    const list = await callList('GET', pageId);
    expect(list.status).toBe(200);
    const { suggestions } = list.body as { suggestions: Array<{ id: string }> };
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.id).toBe(suggestionId);
  });

  it('editor accepts → 200, row accepted, content cleaned', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const pageId = await seedPage(u);
    await setActor(u.userId);

    const id = await proposeSuggestion(getDb(), { pageId, authorId: u.userId });
    await getDb()
      .update(schema.pages)
      .set({
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'kept ' },
                {
                  type: 'text',
                  text: 'added',
                  marks: [
                    {
                      type: 'suggestionInsert',
                      attrs: { suggestionId: id, authorId: u.userId, createdAt: 'x' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
      .where(eq(schema.pages.id, pageId));

    const r = await callResolve(pageId, id, { action: 'accept' });
    expect(r.status).toBe(200);

    const [row] = await getDb()
      .select({ status: schema.suggestions.status })
      .from(schema.suggestions)
      .where(eq(schema.suggestions.id, id));
    expect(row?.status).toBe('accepted');

    const [page] = await getDb()
      .select({ content: schema.pages.content })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId));
    const text = JSON.stringify(page?.content);
    expect(text).not.toContain('suggestionInsert');
    expect(text).toContain('added');
    expect(text).toContain('kept');
  });

  it('accepting an already-resolved suggestion → 409 already_resolved', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const pageId = await seedPage(u);
    await setActor(u.userId);

    const id = await proposeSuggestion(getDb(), { pageId, authorId: u.userId });
    const first = await callResolve(pageId, id, { action: 'accept' });
    expect(first.status).toBe(200);

    const second = await callResolve(pageId, id, { action: 'accept' });
    expect(second.status).toBe(409);
    expect((second.body as { error: string }).error).toBe('already_resolved');
  });

  it('cross-workspace page → 404', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const pageId = await seedPage(other);
    await setActor(editor.userId);
    const r = await callList('POST', pageId);
    expect(r.status).toBe(404);
  });
});
