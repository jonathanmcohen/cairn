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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
  vi.mocked(runImportMod.runImport).mockReset();
  vi.mocked(runImportMod.runImport).mockResolvedValue({
    source: 'workspace-archive',
    counts: { pages: 3, databases: 1, rows: 5, files: 2 },
    warnings: [],
  });
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
vi.mock('@/lib/import/run', () => ({
  runImport: vi.fn(),
}));

const runImportMod = await import('@/lib/import/run');

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
async function addMember(workspaceId: string, userId: string, role: schema.MemberRole) {
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

function formData(opts: { source?: string; workspaceId?: string; filename?: string }): FormData {
  const form = new FormData();
  form.set('file', new Blob(['x'], { type: 'application/zip' }), opts.filename ?? 'x.zip');
  if (opts.source !== undefined) form.set('source', opts.source);
  if (opts.workspaceId !== undefined) form.set('workspaceId', opts.workspaceId);
  return form;
}

async function post(form: FormData): Promise<Response> {
  const { POST } = await import('@/app/api/imports/route');
  return POST(new Request('http://localhost/api/imports', { method: 'POST', body: form }));
}

describe('POST /api/imports', () => {
  it('returns 401 when unauthenticated', async () => {
    const w = await ws();
    active = { name: 'cairn_ws', value: w };
    await setUser(null);
    const res = await post(formData({ source: 'workspace-archive', workspaceId: w }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin role (editor)', async () => {
    const w = await ws();
    const ed = await user('editor');
    await addMember(w, ed, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: ed });
    const res = await post(formData({ source: 'workspace-archive', workspaceId: w }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when the admin targets a workspace they do not admin', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const admin = await user('admin');
    await addMember(w1, admin, 'admin');
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: admin });
    const res = await post(formData({ source: 'workspace-archive', workspaceId: w2 }));
    expect(res.status).toBe(403);
  });

  it('returns 400 for an unknown source', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const res = await post(formData({ source: 'nope', workspaceId: w }));
    expect(res.status).toBe(400);
  });

  it('returns an SSE stream emitting progress + done events on success', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const res = await post(formData({ source: 'workspace-archive', workspaceId: w }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toMatch(/event: progress/);
    expect(text).toMatch(/event: done/);
    expect(text).toMatch(/"pages":3/);
  });

  it('emits an error event when runImport throws', async () => {
    vi.mocked(runImportMod.runImport).mockRejectedValueOnce(new Error('bundle corrupt'));
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const res = await post(formData({ source: 'workspace-archive', workspaceId: w }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/event: error/);
    expect(text).toMatch(/bundle corrupt/);
  });
});
