import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { LocalDiskStorage } from '@/lib/files/storage';
import { storeUpload } from '@/lib/files/upload';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let root = '';
const SECRET = 'x'.repeat(32);

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  root = await mkdtemp(join(tmpdir(), 'cairn-up-'));
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`TRUNCATE files, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('storeUpload', () => {
  it('writes the file and inserts a row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const store = new LocalDiskStorage(root);
    const result = await storeUpload({
      db,
      storage: store,
      secret: SECRET,
      workspaceId: u.workspaceId,
      uploadedBy: u.userId,
      filename: 'cat.png',
      mimeType: 'image/png',
      body: Buffer.from('PNG bytes'),
    });
    expect(result.file.name).toBe('cat.png');
    expect(result.file.mimeType).toBe('image/png');
    expect(result.signedUrl).toMatch(/^\/api\/files\/[0-9a-f-]+\?sig=[a-f0-9]+&exp=\d+$/);
  });

  it('rejects mime types not in allowlist', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const store = new LocalDiskStorage(root);
    await expect(
      storeUpload({
        db,
        storage: store,
        secret: SECRET,
        workspaceId: u.workspaceId,
        uploadedBy: u.userId,
        filename: 'evil.exe',
        mimeType: 'application/x-msdownload',
        body: Buffer.from('binary'),
      }),
    ).rejects.toThrow(/mime/i);
  });
});
