import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

// requireRole resolves the active workspace from the membership of this user.
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
      content: { type: 'doc', content: [] },
    },
  ],
  databases: [],
};

async function seedTemplate(workspaceId: string | null): Promise<string> {
  const [row] = await getDb()
    .insert(schema.templates)
    .values({
      name: 'Notes',
      kind: 'page',
      workspaceId,
      builtIn: false,
      visibility: 'workspace',
      payload: PAGE_PAYLOAD as never,
    } as never)
    .returning({ id: schema.templates.id });
  if (!row) throw new Error('seed failed');
  return row.id;
}

async function seedPage(workspaceId: string, createdBy: string, title: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy, content: { type: 'doc', content: [] } } as never)
    .returning({ id: schema.pages.id });
  if (!row) throw new Error('seed page failed');
  return row.id;
}

async function instantiate(id: string, body?: unknown) {
  const { POST } = await import('@/app/api/templates/[id]/instantiate/route');
  const res = await POST(
    new Request(`http://localhost/api/templates/${id}/instantiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('POST /api/templates/[id]/instantiate (Q-4 parentId)', () => {
  it('grafts the new root under a supplied parentId in the workspace', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const parent = await seedPage(me.workspaceId, me.userId, 'Cairn Guide');
    const tpl = await seedTemplate(me.workspaceId);
    await setUser(me.userId);

    const r = await instantiate(tpl, { parentId: parent });
    expect(r.status).toBe(201);
    const rootId = (r.body as { rootPageId: string }).rootPageId;
    const [row] = await getDb()
      .select({ parentId: schema.pages.parentId })
      .from(schema.pages)
      .where(eq(schema.pages.id, rootId))
      .limit(1);
    expect(row?.parentId).toBe(parent);
  });

  it('defaults to the sidebar root when no parentId is given', async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const tpl = await seedTemplate(me.workspaceId);
    await setUser(me.userId);

    const r = await instantiate(tpl); // no body
    expect(r.status).toBe(201);
    const rootId = (r.body as { rootPageId: string }).rootPageId;
    const [row] = await getDb()
      .select({ parentId: schema.pages.parentId })
      .from(schema.pages)
      .where(eq(schema.pages.id, rootId))
      .limit(1);
    expect(row?.parentId).toBeNull();
  });

  it("400 invalid_parent when the parentId is another workspace's page", async () => {
    const me = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const theirPage = await seedPage(other.workspaceId, other.userId, 'Theirs');
    const tpl = await seedTemplate(me.workspaceId);
    await setUser(me.userId);

    const r = await instantiate(tpl, { parentId: theirPage });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe('invalid_parent');
  });
});
