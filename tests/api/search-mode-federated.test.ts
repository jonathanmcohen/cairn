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

// Stub the embedding provider so semantic/hybrid don't try to load the local
// transformers model (absent in CI/test containers). A deterministic 384-dim
// vector is enough: with no page_embeddings rows the kNN query returns [], so
// the route still resolves 200 — proving it accepts + forwards the mode rather
// than rejecting it as an unknown mode (the contract the UI depends on).
vi.mock('@/lib/search/embed', () => ({
  getEmbeddingProvider: () => ({
    dimension: 384,
    embed: async () => new Float32Array(384).fill(0.01),
  }),
  __resetEmbeddingProviderForTests: () => {},
}));

// Mirror tests/api/search.test.ts: mock auth/config with an __set hook.
vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(qs: string) {
  const { GET } = await import('@/app/api/search/route');
  const res = await GET(new Request(`http://localhost/api/search?${qs}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('GET /api/search — mode + federated contract (#164)', () => {
  it('accepts mode=semantic (not a 400)', async () => {
    await asUser('viewer');
    const r = await call('q=roadmap&mode=semantic');
    expect(r.status).toBe(200);
  });

  it('accepts mode=hybrid', async () => {
    await asUser('viewer');
    const r = await call('q=roadmap&mode=hybrid');
    expect(r.status).toBe(200);
  });

  it('rejects an unknown mode with 400', async () => {
    await asUser('viewer');
    const r = await call('q=roadmap&mode=bogus');
    expect(r.status).toBe(400);
  });

  it('admin include_all_workspaces=true returns the federated shape', async () => {
    const u = await asUser('admin');
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Roadmap',
    });
    const r = await call('q=roadmap&mode=fts&include_all_workspaces=true');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('peer_results');
  });
});
