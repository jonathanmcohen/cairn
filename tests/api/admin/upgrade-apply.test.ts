/**
 * v0.9.0 G8 P42 — POST /api/admin/upgrade/apply (SSE stream).
 *
 * Covers role gating (401 / 403 / 200) and the streamed event shape. The
 * applyUpgrade implementation is mocked to a deterministic two-event
 * sequence so the test never touches pg_dump / pg_restore.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let activeCookie: { name: string; value: string } | undefined;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => activeCookie,
    set: () => {},
    delete: () => {},
  }),
}));

// Mock applyUpgrade — we don't need pg_dump or real migrations to exercise
// the SSE plumbing; we just need stages to land on the wire.
vi.mock('@/lib/upgrade/apply', () => ({
  applyUpgrade: async (input: {
    onProgress?: (e: { stage: string; message?: string }) => void;
  }): Promise<{ ok: boolean }> => {
    input.onProgress?.({ stage: 'snapshot' });
    input.onProgress?.({ stage: 'done' });
    return { ok: true };
  },
}));

async function actAs(userId: string, workspaceId: string): Promise<void> {
  const a = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  a.__set({ userId });
  activeCookie = { name: 'cairn_ws', value: workspaceId };
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  activeCookie = undefined;
  const a = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  a.__set(null);
});

describe('POST /api/admin/upgrade/apply', () => {
  it('401s when unauthenticated', async () => {
    const { POST } = await import('@/app/api/admin/upgrade/apply/route');
    const res = await POST(new Request('http://x/api/admin/upgrade/apply', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('403s for editor', async () => {
    const editor = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(editor.userId, editor.workspaceId);
    const { POST } = await import('@/app/api/admin/upgrade/apply/route');
    const res = await POST(new Request('http://x/api/admin/upgrade/apply', { method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('streams SSE events when invoked by an admin', async () => {
    const admin = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(admin.userId, admin.workspaceId);
    const { POST } = await import('@/app/api/admin/upgrade/apply/route');
    const res = await POST(new Request('http://x/api/admin/upgrade/apply', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: {"stage":"snapshot"}');
    expect(text).toContain('data: {"stage":"done"}');
  });

  it('streams SSE events when invoked by an owner', async () => {
    const owner = await createTestWorkspaceWithUser(db, { role: 'owner' });
    await actAs(owner.userId, owner.workspaceId);
    const { POST } = await import('@/app/api/admin/upgrade/apply/route');
    const res = await POST(new Request('http://x/api/admin/upgrade/apply', { method: 'POST' }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('data: {"stage":"done"}');
  });
});
