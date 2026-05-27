import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, type Readable as ReadableT } from 'node:stream';
import postgres from 'postgres';
import { Open } from 'unzipper';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { exportWorkspace } from '@/lib/export/static-site';
import type { FileStorage } from '@/lib/files/storage';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

const U = '11111111-1111-1111-1111-111111111135';

beforeEach(async () => {
  await sql`TRUNCATE audit_log, pages, files, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name) VALUES ('${U}', 'd@x', 'h', 'd');
  `);
});

async function streamToBuffer(stream: ReadableT): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}

function stubStorage(returnBytes: Buffer): FileStorage {
  return {
    put: async () => {},
    exists: async () => true,
    delete: async () => {},
    read: () => Readable.from([returnBytes]),
  };
}

describe('exportWorkspace (docusaurus)', () => {
  it('produces a ZIP with docusaurus.config.js + sidebars.js + docs/*.md', async () => {
    const W = 'd1111111-1111-1111-1111-111111111135';
    await sql.unsafe(`
      INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'Docs', 'docs-${Date.now()}');
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W}', '${U}', 'owner');
      INSERT INTO pages (id, workspace_id, title, content, created_by)
        VALUES (gen_random_uuid(), '${W}', 'Intro',
                '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]}'::jsonb,
                '${U}');
    `);

    const stream = await exportWorkspace(getDb(), {
      workspaceId: W,
      target: 'docusaurus',
      storage: stubStorage(Buffer.alloc(0)),
    });
    const buf = await streamToBuffer(stream);
    const zipPath = join(tmpdir(), `docusaurus-${Date.now()}.zip`);
    await writeFile(zipPath, buf);
    const dir = await Open.file(zipPath);
    const paths = dir.files.map((f) => f.path);

    expect(paths).toEqual(expect.arrayContaining(['docusaurus.config.js', 'sidebars.js']));
    expect(paths.some((p) => p.startsWith('docs/') && p.endsWith('.md'))).toBe(true);

    const configFile = dir.files.find((f) => f.path === 'docusaurus.config.js');
    if (!configFile) throw new Error('docusaurus.config.js missing');
    const cfg = (await configFile.buffer()).toString('utf-8');
    expect(cfg).toContain("title: 'Docs'");
    expect(cfg).toContain('preset-classic');

    const sidebarsFile = dir.files.find((f) => f.path === 'sidebars.js');
    if (!sidebarsFile) throw new Error('sidebars.js missing');
    const sidebars = (await sidebarsFile.buffer()).toString('utf-8');
    expect(sidebars).toContain('module.exports');
    expect(sidebars).toMatch(/intro/);
  });
});
