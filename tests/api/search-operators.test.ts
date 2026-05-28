import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { createTemplate } from '@/lib/search/saved';
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
  await sql`TRUNCATE pages, saved_searches, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer' = 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(query: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ q: query, ...extra });
  const { GET } = await import('@/app/api/search/route');
  const res = await GET(new Request(`http://localhost/api/search?${params.toString()}`));
  return { status: res.status, body: await res.json() };
}

describe('GET /api/search with operators + templates', () => {
  it('expands a template @name in the q string', async () => {
    const u = await asUser('viewer');
    await createTemplate(getDb(), {
      workspaceId: u.workspaceId,
      userId: u.userId,
      templateName: 'mine',
      expansion: `from:${u.userId}`,
    });
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Owned roadmap',
    });
    // A second user with their own page in the same workspace, so the filter
    // actually has to discriminate.
    const [otherUser] = await getDb()
      .insert(schema.users)
      .values({ email: 'other@example.com', passwordHash: 'h', name: 'other' })
      .returning();
    if (!otherUser) throw new Error('seed user');
    await getDb().insert(schema.workspaceMembers).values({
      workspaceId: u.workspaceId,
      userId: otherUser.id,
      role: 'editor',
    });
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: otherUser.id,
      title: 'Other roadmap',
    });

    const r = await call('@mine roadmap');
    expect(r.status).toBe(200);
    const titles = (r.body as { results: { title: string }[] }).results.map((p) => p.title);
    expect(titles).toContain('Owned roadmap');
    expect(titles).not.toContain('Other roadmap');
  });

  it('resolves from:<email> against users.email', async () => {
    const u = await asUser('viewer');
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Mine roadmap',
    });
    // Fetch the seeded user's email.
    const [me] = await getDb()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, u.userId))
      .limit(1);
    if (!me) throw new Error('lookup me');
    const r = await call(`from:${me.email} roadmap`);
    expect(r.status).toBe(200);
    const titles = (r.body as { results: { title: string }[] }).results.map((p) => p.title);
    expect(titles).toContain('Mine roadmap');
  });

  it('URL filter params win over operator-derived filters on conflict', async () => {
    const u = await asUser('viewer');
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Operator roadmap',
    });
    // Operator says from:<u.userId>; URL says author=<bogus uuid> → 0 matches.
    const other = '00000000-0000-0000-0000-000000000000';
    const r = await call(`from:${u.userId} roadmap`, { author: other });
    expect(r.status).toBe(200);
    expect((r.body as { results: unknown[] }).results).toEqual([]);
  });

  it('strips known operator tokens from the FTS q before calling searchPages', async () => {
    const u = await asUser('viewer');
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Release notes 1.0',
    });
    // `from:nobody-such-email@example.com` won't resolve to a user, so it
    // drops out of filters; the FTS query becomes just "release notes" and
    // matches our page. If the operator token bled into the FTS query as
    // free text, the page would not match (no "from" token in body).
    const r = await call('release notes from:nobody-such-email@example.com');
    expect(r.status).toBe(200);
    const titles = (r.body as { results: { title: string }[] }).results.map((p) => p.title);
    expect(titles).toContain('Release notes 1.0');
  });
});
