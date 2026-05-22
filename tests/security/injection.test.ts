import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { searchPages } from '@/lib/pages/search';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function actAs(userId: string): Promise<void> {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

let sql_: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql_ = postgres(uri);
  db = drizzle(sql_, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql_.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql_`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

const INJECTION = "Robert'); DROP TABLE pages;--";

describe('SQL injection inertness', () => {
  it('injection-shaped title is stored literally and the table survives', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    const [p] = await db
      .insert(schema.pages)
      .values({ workspaceId: ws.workspaceId, title: INJECTION, createdBy: ws.userId })
      .returning();
    if (!p) throw new Error('seed failed');
    const [got] = await db.select().from(schema.pages).where(eq(schema.pages.id, p.id));
    expect(got?.title).toBe(INJECTION); // stored verbatim, not executed
    // table still exists:
    const [count] = (await db.execute(
      sql`SELECT count(*)::int AS n FROM pages`,
    )) as unknown as Array<{ n: number }>;
    expect(count?.n).toBeGreaterThanOrEqual(1);
  });

  it('injection-shaped search query is parameterized (no error, no escape)', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    await db
      .insert(schema.pages)
      .values({ workspaceId: ws.workspaceId, title: 'normal', createdBy: ws.userId });
    const results = await searchPages(db, { workspaceId: ws.workspaceId, query: INJECTION });
    expect(Array.isArray(results)).toBe(true); // ran safely, returned a list
    // table survived the malicious query string:
    const [count] = (await db.execute(
      sql`SELECT count(*)::int AS n FROM pages`,
    )) as unknown as Array<{ n: number }>;
    expect(count?.n).toBe(1);
  });

  it('a literal-match search treats injection text as data, not SQL', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    await db
      .insert(schema.pages)
      .values({ workspaceId: ws.workspaceId, title: INJECTION, createdBy: ws.userId });
    // The injection string survives a round-trip and is matchable as literal data.
    const [got] = await db.select().from(schema.pages).where(eq(schema.pages.title, INJECTION));
    expect(got?.title).toBe(INJECTION);
  });

  it('a malformed (non-uuid) page id is rejected cleanly, never a 500/SQL leak', async () => {
    // Seed against the route's own connection (getDb reads DATABASE_URL).
    const ws = await createTestWorkspaceWithUser(getDb());
    await actAs(ws.userId);
    const route = await import('@/app/api/pages/[pageId]/route');
    const res = await route.GET(new Request('http://t/api/pages/not-a-uuid'), {
      params: Promise.resolve({ pageId: 'not-a-uuid' }),
    });
    // The id never reaches the uuid column → clean 404, no Postgres cast error.
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toMatch(/invalid input syntax|uuid|syntax error/i);
  });
});
