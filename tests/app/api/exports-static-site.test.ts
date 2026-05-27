import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../../helpers/db';

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

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

// Valid v4 UUIDs (version=4, variant=8/9/a/b) — Zod 4's strict uuid validator
// rejects sequences that don't match the version+variant bit layout.
const U = '11111111-1111-4111-8111-111111111140';
const W = '21111111-1111-4111-8111-111111111140';

beforeEach(async () => {
  await sql`TRUNCATE audit_log, pages, files, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await setUser(null);
});

async function seedAdmin() {
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name) VALUES ('${U}', 'a@x', 'h', 'a');
    INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'WS', 'ws-${Date.now()}');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W}', '${U}', 'admin');
  `);
}

describe('POST /api/exports/static-site', () => {
  it('401s without session', async () => {
    const { POST } = await import('@/app/api/exports/static-site/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: '21111111-1111-4111-8111-111111111141',
          target: 'mkdocs',
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('streams a ZIP with content-type + attachment disposition when authed admin', async () => {
    await seedAdmin();
    await setUser(U);
    const { POST } = await import('@/app/api/exports/static-site/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: W, target: 'mkdocs' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/attachment;.*\.zip/);
    // Consume the body so the underlying stream finalizes cleanly.
    await res.arrayBuffer();
  });

  it('400s when validation fails', async () => {
    await seedAdmin();
    await setUser(U);
    const { POST } = await import('@/app/api/exports/static-site/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'not-a-uuid', target: 'mkdocs' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
