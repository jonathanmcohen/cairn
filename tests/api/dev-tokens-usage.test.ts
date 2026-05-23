import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintPat } from '@/lib/auth/pat';
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
  const auth = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  auth.__set({ userId });
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(32);
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE token_usage_log, personal_access_tokens, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seedUsage(workspaceId: string, tokenId: string, userId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await sql`
      INSERT INTO token_usage_log (workspace_id, token_kind, token_id, user_id, route, status)
      VALUES (${workspaceId}, 'pat', ${tokenId}, ${userId}, ${`/api/v1/pages/${i}`}, 200)
    `;
  }
}

describe('GET /api/dev/tokens/[tokenId]/usage', () => {
  it("returns the requesting user's usage events for the token, newest first", async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 't',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    await seedUsage(u.workspaceId, row.id, u.userId, 3);
    await actAs(u.userId);

    const { GET } = await import('@/app/api/dev/tokens/[tokenId]/usage/route');
    const res = await GET(new Request(`http://localhost/api/dev/tokens/${row.id}/usage`), {
      params: Promise.resolve({ tokenId: row.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: { route: string; status: number }[];
      nextCursor: string | null;
    };
    expect(body.events).toHaveLength(3);
    // Newest-first ordering: the last route inserted (`/api/v1/pages/2`) is first.
    expect(body.events[0]?.route).toBe('/api/v1/pages/2');
  });

  it('paginates via keyset cursor (limit=2 yields nextCursor → 1 more event)', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const { row } = await mintPat(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      name: 't',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    await seedUsage(u.workspaceId, row.id, u.userId, 3);
    await actAs(u.userId);

    const { GET } = await import('@/app/api/dev/tokens/[tokenId]/usage/route');
    const res1 = await GET(new Request(`http://localhost/api/dev/tokens/${row.id}/usage?limit=2`), {
      params: Promise.resolve({ tokenId: row.id }),
    });
    const body1 = (await res1.json()) as {
      events: { route: string }[];
      nextCursor: string | null;
    };
    expect(body1.events).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const res2 = await GET(
      new Request(
        `http://localhost/api/dev/tokens/${row.id}/usage?limit=2&cursor=${encodeURIComponent(body1.nextCursor ?? '')}`,
      ),
      { params: Promise.resolve({ tokenId: row.id }) },
    );
    const body2 = (await res2.json()) as { events: unknown[]; nextCursor: string | null };
    expect(body2.events).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
  });

  it("returns 404 when requesting usage for another user's token (no existence leak)", async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'editor', email: 'a@x.com' });
    const b = await createTestWorkspaceWithUser(db, { role: 'editor', email: 'b@x.com' });
    const { row } = await mintPat(db, {
      userId: a.userId,
      workspaceId: a.workspaceId,
      name: 'a-token',
      scopes: ['pages:read'],
      mcpTools: [],
      expiresAt: null,
    });
    await seedUsage(a.workspaceId, row.id, a.userId, 3);

    await actAs(b.userId);
    const { GET } = await import('@/app/api/dev/tokens/[tokenId]/usage/route');
    const res = await GET(new Request(`http://localhost/api/dev/tokens/${row.id}/usage`), {
      params: Promise.resolve({ tokenId: row.id }),
    });
    expect(res.status).toBe(404);
  });
});
