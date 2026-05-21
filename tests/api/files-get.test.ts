import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { LocalDiskStorage } from '@/lib/files/storage';
import { storeUpload } from '@/lib/files/upload';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let uploadRoot = '';

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  uploadRoot = await mkdtemp(join(tmpdir(), 'cairn-up-get-'));
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
  await sql`TRUNCATE files, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function callGet(fileId: string, sig: string, exp: string) {
  const { GET } = await import('@/app/api/files/[fileId]/route');
  const res = await GET(new Request(`http://localhost/api/files/${fileId}?sig=${sig}&exp=${exp}`), {
    params: Promise.resolve({ fileId }),
  });
  return res;
}

describe('GET /api/files/[fileId]', () => {
  it('returns the bytes with a valid signature', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    const { file, signedUrl } = await storeUpload({
      db: getDb(),
      storage: new LocalDiskStorage(uploadRoot),
      secret: 'x'.repeat(32),
      workspaceId: u.workspaceId,
      uploadedBy: u.userId,
      filename: 'a.png',
      mimeType: 'image/png',
      body: Buffer.from('PIXELS'),
    });
    const url = new URL(signedUrl, 'http://localhost');
    const sig = url.searchParams.get('sig');
    const exp = url.searchParams.get('exp');
    if (!sig || !exp) throw new Error('signed url missing sig/exp');
    const res = await callGet(file.id, sig, exp);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('PIXELS');
  });

  it('rejects missing signature with 401', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    const { file } = await storeUpload({
      db: getDb(),
      storage: new LocalDiskStorage(uploadRoot),
      secret: 'x'.repeat(32),
      workspaceId: u.workspaceId,
      uploadedBy: u.userId,
      filename: 'b.png',
      mimeType: 'image/png',
      body: Buffer.from('x'),
    });
    const res = await callGet(file.id, 'deadbeef', String(Math.floor(Date.now() / 1000) + 60));
    expect(res.status).toBe(401);
  });

  it('returns 401 or 404 for unknown file', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const res = await callGet('00000000-0000-0000-0000-000000000000', 'deadbeef', String(exp));
    expect([401, 404]).toContain(res.status);
  });
});
