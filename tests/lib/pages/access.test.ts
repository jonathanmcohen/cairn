import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let uri = '';

beforeAll(async () => {
  uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
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

async function asUser(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

describe('requirePageAccess', () => {
  it('returns page + ctx when user is in the workspace with sufficient role', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    await asUser(u.userId);
    const { requirePageAccess } = await import('@/lib/pages/access');
    const result = await requirePageAccess(p.id, 'editor');
    expect(result.page.id).toBe(p.id);
    expect(result.ctx.role).toBe('editor');
  });

  it('throws 404 when page does not exist', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await asUser(u.userId);
    const { requirePageAccess } = await import('@/lib/pages/access');
    await expect(
      requirePageAccess('00000000-0000-0000-0000-000000000000', 'viewer'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws 404 when page is in a different workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: b.workspaceId, title: 'P', createdBy: b.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    await asUser(a.userId);
    const { requirePageAccess } = await import('@/lib/pages/access');
    await expect(requirePageAccess(p.id, 'viewer')).rejects.toMatchObject({ status: 404 });
  });

  it('throws 403 when role is insufficient', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'viewer' });
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    await asUser(u.userId);
    const { requirePageAccess } = await import('@/lib/pages/access');
    await expect(requirePageAccess(p.id, 'editor')).rejects.toMatchObject({ status: 403 });
  });

  it('throws 401 when unauthenticated', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: u.userId })
      .returning();
    if (!p) throw new Error('insert failed');
    const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: null) => void };
    mod.__set(null);
    const { requirePageAccess } = await import('@/lib/pages/access');
    await expect(requirePageAccess(p.id, 'viewer')).rejects.toMatchObject({ status: 401 });
  });
});
