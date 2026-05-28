import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, type Readable as ReadableT } from 'node:stream';
import postgres from 'postgres';
import { Open } from 'unzipper';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { exportWorkspace, StaticExportError } from '@/lib/export/static-site';
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

const U = '11111111-1111-1111-1111-111111111130';

beforeEach(async () => {
  await sql`TRUNCATE audit_log, pages, files, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name) VALUES ('${U}', 'a@x', 'h', 'a');
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

describe('exportWorkspace (mkdocs)', () => {
  const W = 'a1111111-1111-1111-1111-111111111130';
  it('produces a ZIP containing mkdocs.yml + docs/*.md per page', async () => {
    await sql.unsafe(`
      INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'Notes', 'notes-${Date.now()}');
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W}', '${U}', 'owner');
      INSERT INTO pages (id, workspace_id, title, content, created_by)
        VALUES (gen_random_uuid(), '${W}', 'Welcome',
                '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hi"}]}]}'::jsonb,
                '${U}');
    `);

    const stream = await exportWorkspace(getDb(), {
      workspaceId: W,
      target: 'mkdocs',
      storage: stubStorage(Buffer.alloc(0)),
    });
    const buf = await streamToBuffer(stream);
    const zipPath = join(tmpdir(), `mkdocs-${Date.now()}.zip`);
    await writeFile(zipPath, buf);
    const dir = await Open.file(zipPath);
    const paths = dir.files.map((f) => f.path).sort();

    expect(paths.some((p) => p === 'mkdocs.yml')).toBe(true);
    expect(paths.some((p) => /^docs\/.+\.md$/.test(p))).toBe(true);

    const ymlFile = dir.files.find((f) => f.path === 'mkdocs.yml')!;
    const yml = (await ymlFile.buffer()).toString('utf-8');
    expect(yml).toMatch(/site_name:\s*Notes/);
    expect(yml).toMatch(/theme:\s*\n\s*name:\s*material/);

    const mdFile = dir.files.find((f) => f.path.endsWith('.md'))!;
    const md = (await mdFile.buffer()).toString('utf-8');
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toMatch(/title:\s*Welcome/);
    expect(md).toMatch(/nav_order:\s*0/);
    expect(md).toContain('Hi');
  });

  it('rewrites image asset links to ./assets/<filename> and bundles the file', async () => {
    const W2 = 'b2222222-2222-2222-2222-222222222230';
    const F = 'c3333333-3333-3333-3333-333333333330';
    await sql.unsafe(`
      INSERT INTO workspaces (id, name, slug) VALUES ('${W2}', 'WithAssets', 'wa-${Date.now()}');
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W2}', '${U}', 'owner');
      INSERT INTO files (id, workspace_id, name, mime_type, size, path, uploaded_by)
        VALUES ('${F}', '${W2}', 'pic.png', 'image/png', 4, 'k/a.png', '${U}');
      INSERT INTO pages (id, workspace_id, title, content, created_by)
        VALUES (gen_random_uuid(), '${W2}', 'Pic',
                '{"type":"doc","content":[{"type":"cairnImage","attrs":{"src":"/api/files/${F}?sig=x&exp=1","alt":"pic"}}]}'::jsonb,
                '${U}');
    `);

    const stream = await exportWorkspace(getDb(), {
      workspaceId: W2,
      target: 'mkdocs',
      storage: stubStorage(Buffer.from('PNG!')),
    });
    const buf = await streamToBuffer(stream);
    const zipPath = join(tmpdir(), `mkdocs-assets-${Date.now()}.zip`);
    await writeFile(zipPath, buf);
    const dir = await Open.file(zipPath);
    const paths = dir.files.map((f) => f.path);

    expect(paths.some((p) => p.startsWith(`docs/assets/${F}-pic.png`))).toBe(true);
    const mdFile = dir.files.find((f) => f.path.endsWith('.md'))!;
    const md = (await mdFile.buffer()).toString('utf-8');
    expect(md).toMatch(new RegExp(`\\.\\/assets\\/${F}-pic\\.png`));
    // The asset file contents survive the zip round-trip.
    const assetFile = dir.files.find((f) => f.path.startsWith('docs/assets/'))!;
    expect((await assetFile.buffer()).toString()).toBe('PNG!');
  });

  it('refuses to export a workspace containing any encrypted page', async () => {
    const W3 = 'd4444444-4444-4444-4444-444444444430';
    await sql.unsafe(`
      INSERT INTO workspaces (id, name, slug) VALUES ('${W3}', 'Locked', 'locked-${Date.now()}');
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W3}', '${U}', 'owner');
      INSERT INTO pages (id, workspace_id, title, content, created_by, encrypted)
        VALUES (gen_random_uuid(), '${W3}', 'Secret', '{}'::jsonb, '${U}', true);
    `);
    await expect(
      exportWorkspace(getDb(), {
        workspaceId: W3,
        target: 'mkdocs',
        storage: stubStorage(Buffer.alloc(0)),
      }),
    ).rejects.toBeInstanceOf(StaticExportError);
  });
});
