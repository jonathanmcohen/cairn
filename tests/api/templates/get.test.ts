import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

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
  await sql`TRUNCATE templates, pages, workspace_members, workspaces, users, audit_log, sessions, accounts RESTART IDENTITY CASCADE`;
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

const PAGE_PAYLOAD = {
  kind: 'page',
  rootPageId: 'p1',
  pages: [
    {
      id: 'p1',
      parentId: null,
      title: 'Meeting notes',
      icon: null,
      content: {
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Agenda' }] }],
      },
    },
  ],
  databases: [],
};

async function seedTemplate(opts: {
  name: string;
  workspaceId: string | null;
  builtIn?: boolean;
  visibility?: schema.TemplateVisibility;
}) {
  const [row] = await getDb()
    .insert(schema.templates)
    .values({
      name: opts.name,
      kind: 'page',
      workspaceId: opts.workspaceId,
      builtIn: opts.builtIn ?? false,
      visibility: opts.visibility ?? 'workspace',
      payload: PAGE_PAYLOAD as never,
    } as never)
    .returning({ id: schema.templates.id });
  if (!row) throw new Error('seed template failed');
  return row.id;
}

async function call(id: string): Promise<{ status: number; body: unknown }> {
  const { GET } = await import('@/app/api/templates/[id]/route');
  const res = await GET(new Request(`http://localhost/api/templates/${id}`), {
    params: Promise.resolve({ id }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('GET /api/templates/[id]', () => {
  it('200 + preview for a built-in template, for any member', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const id = await seedTemplate({ name: 'Welcome', workspaceId: null, builtIn: true, visibility: 'public' });
    await setUser(u.userId);
    const r = await call(id);
    expect(r.status).toBe(200);
    const body = r.body as { id: string; name: string; kind: string; blocks: unknown[] };
    expect(body.id).toBe(id);
    expect(body.name).toBe('Welcome');
    expect(body.kind).toBe('page');
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  it('404 for a workspace template in another workspace', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const id = await seedTemplate({ name: 'Theirs', workspaceId: owner.workspaceId, visibility: 'workspace' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setUser(other.userId);
    const r = await call(id);
    expect(r.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const id = await seedTemplate({ name: 'X', workspaceId: owner.workspaceId });
    await setUser(null);
    const r = await call(id);
    expect(r.status).toBe(401);
  });
});
