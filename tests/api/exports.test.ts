import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
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
  putSpy.mockReset();
  existsSpy.mockReset().mockResolvedValue(true);
  readSpy.mockReset().mockReturnValue(Readable.from([Buffer.from('ZIPDATA')]));
  vi.mocked(exportMod.runWorkspaceExport).mockReset();
  vi.mocked(exportMod.runWorkspaceExport).mockImplementation(
    async (args: { workspaceId: string; outDir: string }) => {
      const path = `${args.outDir}/cairn-export-${args.workspaceId}-stub.zip`;
      // The route reads the produced archive off disk before mirroring to
      // FileStorage — write a tiny stand-in so the readFile call resolves.
      await writeFile(path, Buffer.from('ZIPDATA'));
      return path;
    },
  );
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

const putSpy = vi.fn();
const existsSpy = vi.fn();
const readSpy = vi.fn();
vi.mock('@/lib/files/get-storage', () => ({
  getStorage: () => ({
    put: putSpy,
    exists: existsSpy,
    delete: async () => {},
    read: readSpy,
  }),
}));
vi.mock('@/lib/export/workspace-archive', () => ({
  runWorkspaceExport: vi.fn(),
}));

const exportMod = await import('@/lib/export/workspace-archive');

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

async function post(body: unknown): Promise<Response> {
  const { POST } = await import('@/app/api/exports/route');
  return POST(
    new Request('http://localhost/api/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/exports', () => {
  it('returns 401 when unauthenticated', async () => {
    const w = await ws();
    active = { name: 'cairn_ws', value: w };
    await setUser(null);
    const res = await post({ workspaceId: w });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin role (editor)', async () => {
    const w = await ws();
    const ed = await user('editor');
    await addMember(w, ed, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: ed });
    const res = await post({ workspaceId: w });
    expect(res.status).toBe(403);
  });

  it('returns 403 when targeting a different workspace', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const admin = await user('admin');
    await addMember(w1, admin, 'admin');
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: admin });
    const res = await post({ workspaceId: w2 });
    expect(res.status).toBe(403);
  });

  it('runs the export, mirrors to FileStorage under backups/, returns a signed URL', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const res = await post({ workspaceId: w });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; key: string; sizeBytes: number };
    expect(body.url).toMatch(/^\/api\/exports\/download\?/);
    expect(body.url).toMatch(/sig=/);
    expect(body.url).toMatch(/exp=/);
    expect(body.key).toMatch(/^backups\/cairn-export-/);
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(putSpy).toHaveBeenCalledOnce();
    const call = putSpy.mock.calls[0];
    if (!call) throw new Error('expected put call');
    expect(call[0]).toMatch(/^backups\/cairn-export-/);
    expect(call[2]).toBe('application/zip');
  });
});

describe('GET /api/exports/download', () => {
  it('rejects an unsigned request with 401', async () => {
    const { GET } = await import('@/app/api/exports/download/route');
    const res = await GET(new Request('http://localhost/api/exports/download?key=backups/x.zip'));
    expect(res.status).toBe(401);
  });

  it('rejects a tampered signature with 401', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const post1 = await post({ workspaceId: w });
    const body = (await post1.json()) as { url: string };
    const tampered = body.url.replace(/sig=([0-9a-f]+)/, 'sig=deadbeef');
    const { GET } = await import('@/app/api/exports/download/route');
    const res = await GET(new Request(`http://localhost${tampered}`));
    expect(res.status).toBe(401);
  });

  it('streams the archive bytes when the signed URL is valid', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const post1 = await post({ workspaceId: w });
    const body = (await post1.json()) as { url: string };
    const { GET } = await import('@/app/api/exports/download/route');
    const res = await GET(new Request(`http://localhost${body.url}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe('ZIPDATA');
  });

  it('rejects an expired signature with 401', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const post1 = await post({ workspaceId: w });
    const body = (await post1.json()) as { url: string };
    const expiredUrl = body.url.replace(/exp=\d+/, 'exp=1');
    const { GET } = await import('@/app/api/exports/download/route');
    const res = await GET(new Request(`http://localhost${expiredUrl}`));
    expect(res.status).toBe(401);
  });
});
