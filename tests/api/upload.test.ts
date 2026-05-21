import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let uploadRoot = '';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  uploadRoot = await mkdtemp(join(tmpdir(), 'cairn-up-api-'));
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.CAIRN_UPLOAD_ROOT = uploadRoot;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  await rm(uploadRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`TRUNCATE files, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(form: FormData) {
  const { POST } = await import('@/app/api/upload/route');
  const res = await POST(
    new Request('http://localhost/api/upload', { method: 'POST', body: form }),
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('POST /api/upload', () => {
  it('editor can upload a png', async () => {
    await asUser('editor');
    const fd = new FormData();
    fd.set('file', new Blob([Buffer.from('PNG')], { type: 'image/png' }), 'a.png');
    const r = await call(fd);
    expect(r.status).toBe(201);
    expect((r.body as { signedUrl: string }).signedUrl).toMatch(/sig=/);
  });

  it('viewer is 403', async () => {
    await asUser('viewer');
    const fd = new FormData();
    fd.set('file', new Blob([Buffer.from('PNG')], { type: 'image/png' }), 'a.png');
    const r = await call(fd);
    expect(r.status).toBe(403);
  });

  it('rejects oversized files', async () => {
    await asUser('editor');
    const prev = process.env.CAIRN_MAX_UPLOAD_MB;
    process.env.CAIRN_MAX_UPLOAD_MB = '1';
    try {
      const fd = new FormData();
      fd.set('file', new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
      const r = await call(fd);
      expect(r.status).toBe(413);
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, 'CAIRN_MAX_UPLOAD_MB');
      } else {
        process.env.CAIRN_MAX_UPLOAD_MB = prev;
      }
    }
  });

  it('rejects disallowed mime', async () => {
    await asUser('editor');
    const fd = new FormData();
    fd.set('file', new Blob([Buffer.from('x')], { type: 'application/x-msdownload' }), 'evil.exe');
    const r = await call(fd);
    expect(r.status).toBe(415);
  });
});
