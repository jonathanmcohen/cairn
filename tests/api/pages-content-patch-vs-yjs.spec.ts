/**
 * v0.9.15 #A3 — REST PATCH content writes are no longer lost to the live Yjs doc.
 *
 * BEFORE: while an editor session held the Y.Doc open in Hocuspocus, the next
 * materialize() flush overwrote pages.content with the Yjs state, silently
 * losing any REST PATCH content write on hard reload.
 *
 * FIX (Option A): after committing the DB write, updatePage() PUBLISHES the new
 * content into the live Y.Doc via the collab process's internal HTTP endpoint
 * (POST /internal/pages/:id/replace). The collab server applies it to the open
 * doc (or no-ops if none is open), so a subsequent materialize() flush reflects
 * the API write instead of clobbering it. The publish is best-effort and never
 * breaks the save.
 *
 * This suite asserts:
 *   (a) with NO collab configured (CAIRN_COLLAB_INTERNAL_URL unset), PATCH content
 *       persists and reads back — the publish path no-ops (single-process safe).
 *   (b) with collab configured, the PATCH invokes the publish path: a POST to the
 *       collab replace endpoint carrying the SAME content, bearer-authed with
 *       AUTH_SECRET. (We mock fetch — a live Hocuspocus process isn't needed; the
 *       in-process apply is covered by tests/collab/internal-replace.test.ts.)
 *   (c) a collab outage (publish throws) does NOT break the PATCH — the DB write
 *       still persists and the route returns 200.
 */
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.CAIRN_COLLAB_INTERNAL_URL = undefined;
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

vi.mock('next/headers', () => {
  let workspaceId: string | undefined;
  return {
    cookies: async () => ({
      get: (name: string) =>
        name === 'cairn_ws' && workspaceId ? { name: 'cairn_ws', value: workspaceId } : undefined,
      set: () => {},
    }),
    __setWorkspaceId: (id: string) => {
      workspaceId = id;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const authMod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  authMod.__set({ userId: u.userId });
  const headersMod = (await import('next/headers')) as unknown as {
    __setWorkspaceId: (id: string) => void;
  };
  headersMod.__setWorkspaceId(u.workspaceId);
  return u;
}

const newContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'API-written content' }] }],
};

// Wait for the fire-and-forget publish (a void async IIFE) to settle.
function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('PATCH /api/pages/[id] content write vs. Yjs (#A3)', () => {
  it('(a) persists content with NO collab configured (publish path no-ops)', async () => {
    delete process.env.CAIRN_COLLAB_INTERNAL_URL;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const u = await asUser('editor');
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'A3 no-collab',
    });

    const { PATCH } = await import('@/app/api/pages/[pageId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);
    await flushMicrotasks();

    const [row] = await sql<{ content: unknown }[]>`
      SELECT content FROM pages WHERE id = ${page.id}::uuid
    `;
    expect(JSON.stringify(row?.content)).toContain('API-written content');
    // Publish disabled: no outbound call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('(b) publishes the API content into the live Yjs doc when collab is configured', async () => {
    process.env.CAIRN_COLLAB_INTERNAL_URL = 'http://collab.internal:1234';
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ applied: true }), { status: 200 });
      });

    const u = await asUser('editor');
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'A3 publish',
    });

    const { PATCH } = await import('@/app/api/pages/[pageId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);
    await flushMicrotasks();

    // The DB write persisted...
    const [row] = await sql<{ content: unknown }[]>`
      SELECT content FROM pages WHERE id = ${page.id}::uuid
    `;
    expect(JSON.stringify(row?.content)).toContain('API-written content');

    // ...AND the publish path was invoked against the collab replace endpoint,
    // bearer-authed, carrying the same content (so an open Yjs doc gets the
    // API write rather than clobbering it on the next materialize flush).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = calls[0];
    if (!call) throw new Error('expected a publish call');
    expect(call.url).toBe(`http://collab.internal:1234/internal/pages/${page.id}/replace`);
    expect(call.init.method).toBe('POST');
    expect((call.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${'x'.repeat(32)}`,
    );
    expect(String(call.init.body)).toContain('API-written content');
  });

  it('(c) a collab outage does NOT break the PATCH (DB write still persists)', async () => {
    process.env.CAIRN_COLLAB_INTERNAL_URL = 'http://collab.internal:1234';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const u = await asUser('editor');
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'A3 outage',
    });

    const { PATCH } = await import('@/app/api/pages/[pageId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    // The save succeeds despite the collab outage.
    expect(res.status).toBe(200);
    await flushMicrotasks();

    const [row] = await sql<{ content: unknown }[]>`
      SELECT content FROM pages WHERE id = ${page.id}::uuid
    `;
    expect(JSON.stringify(row?.content)).toContain('API-written content');
  });
});
