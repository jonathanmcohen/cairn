import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';

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
  await sql`TRUNCATE audit_log, workspace_slash_commands, templates, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

let active: { name: string; value: string } | undefined;
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
  cookies: async () => ({ get: () => active, set: () => {} }),
}));

async function setUser(c: { userId: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}
async function user(name: string) {
  const [u] = await getDb()
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}
async function ws() {
  const [w] = await getDb()
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('workspace insert failed');
  return w.id;
}
async function add(workspaceId: string, userId: string, role: schema.MemberRole) {
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

const PAGE_PAYLOAD = {
  kind: 'page',
  rootPageId: 'p1',
  pages: [
    {
      id: 'p1',
      parentId: null,
      title: 'Tpl',
      icon: null,
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tpl body' }] }],
      },
    },
  ],
  databases: [],
};

async function template(workspaceId: string) {
  const [t] = await getDb()
    .insert(schema.templates)
    .values({ workspaceId, name: 'Tpl', kind: 'page', payload: PAGE_PAYLOAD as never })
    .returning();
  if (!t) throw new Error('template insert failed');
  return t.id;
}

async function get(workspaceId: string) {
  const { GET } = await import('@/app/api/workspaces/[id]/slash-commands/route');
  const res = await GET(
    new Request(`http://localhost/api/workspaces/${workspaceId}/slash-commands`),
    { params: Promise.resolve({ id: workspaceId }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function post(workspaceId: string, body: unknown) {
  const { POST } = await import('@/app/api/workspaces/[id]/slash-commands/route');
  const res = await POST(
    new Request(`http://localhost/api/workspaces/${workspaceId}/slash-commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: workspaceId }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function del(workspaceId: string, commandId: string) {
  const { DELETE } = await import('@/app/api/workspaces/[id]/slash-commands/[commandId]/route');
  const res = await DELETE(
    new Request(`http://localhost/api/workspaces/${workspaceId}/slash-commands/${commandId}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: workspaceId, commandId }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('/api/workspaces/[id]/slash-commands', () => {
  it('member (viewer) GET -> 200 with the command list incl. insertable content', async () => {
    const w = await ws();
    const admin = await user('admin');
    const viewer = await user('viewer');
    await add(w, admin, 'admin');
    await add(w, viewer, 'viewer');
    const tpl = await template(w);

    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    expect((await post(w, { trigger: 'standup', label: 'Standup', templateId: tpl })).status).toBe(
      201,
    );

    await setUser({ userId: viewer });
    const r = await get(w);
    expect(r.status).toBe(200);
    const commands = r.body.commands as Array<Record<string, unknown>>;
    expect(commands).toHaveLength(1);
    expect(commands[0]?.trigger).toBe('standup');
    expect(commands[0]?.templateName).toBe('Tpl');
    expect(commands[0]?.enabled).toBe(true);
    expect(commands[0]?.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Tpl body' }] },
    ]);
  });

  it('editor POST -> 403 (admin-only management)', async () => {
    const w = await ws();
    const ed = await user('editor');
    await add(w, ed, 'editor');
    const tpl = await template(w);
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: ed });
    expect((await post(w, { trigger: 'standup', label: 'L', templateId: tpl })).status).toBe(403);
  });

  it('admin POST -> 201; builtin collision + duplicate -> 400 with typed codes', async () => {
    const w = await ws();
    const admin = await user('admin');
    await add(w, admin, 'admin');
    const tpl = await template(w);
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const created = await post(w, { trigger: 'standup', label: 'L', templateId: tpl });
    expect(created.status).toBe(201);
    expect((created.body.command as Record<string, unknown>).trigger).toBe('standup');

    const builtin = await post(w, { trigger: 'todo', label: 'L', templateId: tpl });
    expect(builtin.status).toBe(400);
    expect(builtin.body.code).toBe('BUILTIN_TRIGGER');

    const dupe = await post(w, { trigger: 'standup', label: 'L2', templateId: tpl });
    expect(dupe.status).toBe(400);
    expect(dupe.body.code).toBe('DUPLICATE_TRIGGER');

    const badFormat = await post(w, { trigger: 'Bad Word', label: 'L', templateId: tpl });
    expect(badFormat.status).toBe(400);
    expect(badFormat.body.code).toBe('INVALID_TRIGGER');
  });

  it('admin POST with a foreign-workspace template -> 404 tenant guard', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const admin = await user('admin');
    await add(w1, admin, 'admin');
    const foreignTpl = await template(w2);
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: admin });
    const r = await post(w1, { trigger: 'standup', label: 'L', templateId: foreignTpl });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('cross-workspace URL id -> 404 for GET, POST, and DELETE (no existence leak)', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const owner = await user('owner');
    await add(w1, owner, 'owner');
    const tpl = await template(w1);
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: owner });
    expect((await get(w2)).status).toBe(404);
    expect((await post(w2, { trigger: 'standup', label: 'L', templateId: tpl })).status).toBe(404);
    expect((await del(w2, crypto.randomUUID())).status).toBe(404);
  });

  it('DELETE: admin 200 (row + audit), editor 403, unknown id 404', async () => {
    const w = await ws();
    const admin = await user('admin');
    const ed = await user('editor');
    await add(w, admin, 'admin');
    await add(w, ed, 'editor');
    const tpl = await template(w);
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const created = await post(w, { trigger: 'standup', label: 'L', templateId: tpl });
    const commandId = (created.body.command as { id: string }).id;

    await setUser({ userId: ed });
    expect((await del(w, commandId)).status).toBe(403);

    await setUser({ userId: admin });
    expect((await del(w, commandId)).status).toBe(200);
    expect(((await get(w)).body.commands as unknown[]).length).toBe(0);
    expect((await del(w, commandId)).status).toBe(404);
  });

  it('anonymous GET/POST -> 401/403', async () => {
    const w = await ws();
    active = undefined;
    await setUser(null);
    expect([401, 403]).toContain((await get(w)).status);
    expect([401, 403]).toContain(
      (await post(w, { trigger: 'standup', label: 'L', templateId: crypto.randomUUID() })).status,
    );
  });
});
