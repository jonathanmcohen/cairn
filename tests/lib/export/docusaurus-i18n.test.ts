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

const U = '11111111-1111-1111-1111-111111111136';

beforeEach(async () => {
  await sql`TRUNCATE audit_log, pages, files, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name) VALUES ('${U}', 'i@x', 'h', 'i');
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

describe('exportWorkspace (docusaurus i18n)', () => {
  it('emits translation pages under i18n/<locale>/docusaurus-plugin-content-docs/current/', async () => {
    const W = 'e1111111-1111-1111-1111-111111111135';
    const CANONICAL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa35';
    await sql.unsafe(`
      INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'I18N', 'i18n-${Date.now()}');
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W}', '${U}', 'owner');
      INSERT INTO pages (id, workspace_id, title, content, created_by)
        VALUES ('${CANONICAL}', '${W}', 'Hello', '{"type":"doc","content":[]}'::jsonb, '${U}');
      INSERT INTO pages (id, workspace_id, title, content, created_by,
                        translation_of_page_id, translation_locale)
        VALUES (gen_random_uuid(), '${W}', 'Hola', '{"type":"doc","content":[]}'::jsonb, '${U}',
                '${CANONICAL}', 'es');
    `);

    const stream = await exportWorkspace(getDb(), {
      workspaceId: W,
      target: 'docusaurus',
      storage: stubStorage(Buffer.alloc(0)),
    });
    const buf = await streamToBuffer(stream);
    const zipPath = join(tmpdir(), `docusaurus-i18n-${Date.now()}.zip`);
    await writeFile(zipPath, buf);
    const dir = await Open.file(zipPath);
    const paths = dir.files.map((f) => f.path);

    expect(paths.some((p) => p.startsWith('i18n/es/docusaurus-plugin-content-docs/current/'))).toBe(
      true,
    );
    // Canonical page emitted once under docs/, not duplicated.
    const docsMds = paths.filter((p) => p.startsWith('docs/') && p.endsWith('.md'));
    expect(docsMds).toHaveLength(1);
    expect(docsMds[0]).toMatch(/hello/);
  });

  it('exports cleanly when a workspace has no translation rows', async () => {
    const W = 'e2222222-2222-2222-2222-222222222235';
    await sql.unsafe(`
      INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'NoTr', 'notr-${Date.now()}');
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W}', '${U}', 'owner');
      INSERT INTO pages (id, workspace_id, title, content, created_by)
        VALUES (gen_random_uuid(), '${W}', 'Solo', '{"type":"doc","content":[]}'::jsonb, '${U}');
    `);
    const stream = await exportWorkspace(getDb(), {
      workspaceId: W,
      target: 'docusaurus',
      storage: stubStorage(Buffer.alloc(0)),
    });
    const buf = await streamToBuffer(stream);
    const zipPath = join(tmpdir(), `docusaurus-notr-${Date.now()}.zip`);
    await writeFile(zipPath, buf);
    const dir = await Open.file(zipPath);
    const paths = dir.files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['docusaurus.config.js', 'sidebars.js']));
    expect(paths.some((p) => p.startsWith('i18n/'))).toBe(false);
  });
});
