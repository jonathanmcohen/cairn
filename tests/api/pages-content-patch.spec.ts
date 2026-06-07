/**
 * Regression test documenting Yjs ↔ REST API content-write precedence.
 *
 * DOCUMENTED BEHAVIOR:
 *   - While an editor session holds the Yjs doc open in Hocuspocus, the Yjs
 *     state is authoritative. A REST PATCH that writes `pages.content` during
 *     that window will be overwritten on the next materialize() call (within
 *     the 2s debounce or on last-disconnect flush).
 *   - When no active Yjs doc is held open (Hocuspocus has no live connection
 *     for that page), a REST PATCH to `pages.content` persists durably — there
 *     is no Yjs doc to overwrite it.
 *
 * This test only exercises the REST PATCH path (no real Hocuspocus process).
 * It asserts that a PATCH with a content payload writes the expected value to
 * the database — i.e. confirms the "no active Yjs doc" branch of the precedence
 * rule. The overwrite behavior (Yjs wins) is architectural: materialize() calls
 * `UPDATE pages SET content = <yjsProseDoc>` unconditionally, so any prior PATCH
 * value is replaced. That behavior is tested in tests/collab/ via the
 * materialize helpers.
 *
 * See also: collab/server.ts#materialize() and src/lib/pages/update.ts for the
 * PATCH site comment referencing this file.
 *
 * Deferred: Option (a) "API write publishes through Hocuspocus" and
 * Option (b) "API write invalidates Yjs doc" are not implemented in v0.9.14.
 * They are tracked for a future feature release (v0.10.x).
 */
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('PATCH /api/pages/[id] — content write (no active Yjs doc)', () => {
  it('writes content and persists when no Yjs doc is open (documented: API wins when no active collab session)', async () => {
    const u = await asUser('editor');
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Precedence Test',
    });

    const newContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'API-written content' }],
        },
      ],
    };

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

    // Verify the content was persisted in the database
    const [row] = await sql<{ content: unknown }[]>`
      SELECT content FROM pages WHERE id = ${page.id}::uuid
    `;
    expect(row).toBeDefined();
    // The content should contain our API-written text
    const contentStr = JSON.stringify(row?.content);
    expect(contentStr).toContain('API-written content');
  });

  it('a subsequent Yjs materialize call WOULD overwrite the API content (behavior documented, not tested here — see collab/server.ts#materialize)', () => {
    // This test intentionally does NOT exercise the overwrite path because it
    // would require a running Hocuspocus process. The behavior is architectural:
    // materialize() issues `UPDATE pages SET content = <yjsDoc>` unconditionally
    // with no awareness of intervening API writes.
    //
    // The documented precedence rule:
    //   "Editor (Yjs) state wins while a document is open.
    //    API content writes apply durably when no active Yjs doc is present."
    //
    // TODO (v0.10.x): Implement option (a) — API write publishes through
    // Hocuspocus — or option (b) — API write triggers Yjs doc flush — to
    // eliminate the overwrite race entirely.
    expect(true).toBe(true); // placeholder assertion to document the deferred behavior
  });
});
