import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { ensureQuotaRow } from '@/lib/quotas/quota';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

// v0.10.0 D6 — route-level coverage for the storage-quota surface:
//   GET   /api/storage/usage                  (viewer-gated read)
//   PATCH /api/admin/storage-quota            (admin-gated limit set/clear)
//   POST  /api/admin/storage-quota/reconcile  (admin-gated drift recount)
//   POST  /api/upload                          (413 mapping on quota breach)

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let uploadRoot = '';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  uploadRoot = await mkdtemp(join(tmpdir(), 'cairn-d6-quota-'));
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

async function asUser(role: schema.MemberRole) {
  const u = await createTestWorkspaceWithUser(db, { role });
  await setUser(u.userId);
  return u;
}

beforeEach(async () => {
  await sql`TRUNCATE workspace_quotas, files, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await setUser(null);
});

function patchReq(body: unknown): Request {
  return new Request('http://test/api/admin/storage-quota', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function quotaRow(workspaceId: string) {
  const [row] = await db
    .select()
    .from(schema.workspaceQuotas)
    .where(eq(schema.workspaceQuotas.workspaceId, workspaceId));
  return row;
}

describe('GET /api/storage/usage', () => {
  it('401 without a session', async () => {
    const { GET } = await import('@/app/api/storage/usage/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('a viewer can read usage; a fresh workspace is 0 / unlimited', async () => {
    await asUser('viewer');
    const { GET } = await import('@/app/api/storage/usage/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usedBytes: 0, limitBytes: null });
  });

  it('reflects the stored counter and limit', async () => {
    const u = await asUser('editor');
    await ensureQuotaRow(db, u.workspaceId);
    await db
      .update(schema.workspaceQuotas)
      .set({ storageBytesLimit: 1_048_576, storageBytesUsed: 4096 })
      .where(eq(schema.workspaceQuotas.workspaceId, u.workspaceId));
    const { GET } = await import('@/app/api/storage/usage/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usedBytes: 4096, limitBytes: 1_048_576 });
  });
});

describe('PATCH /api/admin/storage-quota', () => {
  it('401 without a session', async () => {
    const { PATCH } = await import('@/app/api/admin/storage-quota/route');
    const res = await PATCH(patchReq({ limitBytes: 1024 }));
    expect(res.status).toBe(401);
  });

  it('403 for an editor', async () => {
    await asUser('editor');
    const { PATCH } = await import('@/app/api/admin/storage-quota/route');
    const res = await PATCH(patchReq({ limitBytes: 1024 }));
    expect(res.status).toBe(403);
  });

  it('403 for a viewer', async () => {
    await asUser('viewer');
    const { PATCH } = await import('@/app/api/admin/storage-quota/route');
    const res = await PATCH(patchReq({ limitBytes: 1024 }));
    expect(res.status).toBe(403);
  });

  it('admin sets a limit and gets the updated pair back', async () => {
    const u = await asUser('admin');
    const { PATCH } = await import('@/app/api/admin/storage-quota/route');
    const res = await PATCH(patchReq({ limitBytes: 65_536 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usedBytes: 0, limitBytes: 65_536 });
    expect((await quotaRow(u.workspaceId))?.storageBytesLimit).toBe(65_536);
  });

  it('null clears the limit back to unlimited', async () => {
    const u = await asUser('admin');
    const { PATCH } = await import('@/app/api/admin/storage-quota/route');
    await PATCH(patchReq({ limitBytes: 65_536 }));
    const res = await PATCH(patchReq({ limitBytes: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usedBytes: 0, limitBytes: null });
    expect((await quotaRow(u.workspaceId))?.storageBytesLimit).toBeNull();
  });

  it('rejects negatives, floats, non-numbers, and a missing body', async () => {
    await asUser('admin');
    const { PATCH } = await import('@/app/api/admin/storage-quota/route');
    expect((await PATCH(patchReq({ limitBytes: -1 }))).status).toBe(400);
    expect((await PATCH(patchReq({ limitBytes: 1.5 }))).status).toBe(400);
    expect((await PATCH(patchReq({ limitBytes: 'big' }))).status).toBe(400);
    expect((await PATCH(patchReq({}))).status).toBe(400);
    const noBody = new Request('http://test/api/admin/storage-quota', { method: 'PATCH' });
    expect((await PATCH(noBody)).status).toBe(400);
  });
});

describe('POST /api/admin/storage-quota/reconcile', () => {
  it('403 for an editor', async () => {
    await asUser('editor');
    const { POST } = await import('@/app/api/admin/storage-quota/reconcile/route');
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it('corrects a drifted counter from sum(files.size)', async () => {
    const u = await asUser('admin');
    await ensureQuotaRow(db, u.workspaceId);
    await db.insert(schema.files).values([
      {
        workspaceId: u.workspaceId,
        name: 'a.txt',
        mimeType: 'text/plain',
        size: 100,
        path: `${u.workspaceId}/a`,
        uploadedBy: u.userId,
      },
      {
        workspaceId: u.workspaceId,
        name: 'b.txt',
        mimeType: 'text/plain',
        size: 200,
        path: `${u.workspaceId}/b`,
        uploadedBy: u.userId,
      },
    ]);
    // Skew the live counter well away from the canonical 300.
    await db
      .update(schema.workspaceQuotas)
      .set({ storageBytesUsed: 9_999_999 })
      .where(eq(schema.workspaceQuotas.workspaceId, u.workspaceId));

    const { POST } = await import('@/app/api/admin/storage-quota/reconcile/route');
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usedBytes: 300, limitBytes: null });
    expect((await quotaRow(u.workspaceId))?.storageBytesUsed).toBe(300);
  });
});

describe('POST /api/upload quota mapping', () => {
  it('maps QuotaExceededError to 413 with formatted remaining space', async () => {
    const u = await asUser('editor');
    await ensureQuotaRow(db, u.workspaceId);
    // 100 KB cap with 50 KB already used → 50 KB of headroom.
    await db
      .update(schema.workspaceQuotas)
      .set({ storageBytesLimit: 100 * 1024, storageBytesUsed: 50 * 1024 })
      .where(eq(schema.workspaceQuotas.workspaceId, u.workspaceId));

    const fd = new FormData();
    fd.set('file', new Blob([new Uint8Array(60 * 1024)], { type: 'text/plain' }), 'd6.txt');
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(new Request('http://test/api/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; remainingBytes: number };
    expect(body.error).toContain('50.0 KB remaining');
    expect(body.error).toContain('file is 60.0 KB');
    expect(body.remainingBytes).toBe(50 * 1024);

    // The rejected upload must not have inserted a files row or moved the counter.
    const rows = await db
      .select()
      .from(schema.files)
      .where(eq(schema.files.workspaceId, u.workspaceId));
    expect(rows).toHaveLength(0);
    expect((await quotaRow(u.workspaceId))?.storageBytesUsed).toBe(50 * 1024);
  });

  it('an upload within the remaining headroom still succeeds (201)', async () => {
    const u = await asUser('editor');
    await ensureQuotaRow(db, u.workspaceId);
    await db
      .update(schema.workspaceQuotas)
      .set({ storageBytesLimit: 100 * 1024 })
      .where(eq(schema.workspaceQuotas.workspaceId, u.workspaceId));

    const fd = new FormData();
    fd.set('file', new Blob([new Uint8Array(10 * 1024)], { type: 'text/plain' }), 'ok.txt');
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(new Request('http://test/api/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(201);
    expect((await quotaRow(u.workspaceId))?.storageBytesUsed).toBe(10 * 1024);
  });
});
