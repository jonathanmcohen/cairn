import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { extractAndRewriteAssets } from '@/lib/export/assets';
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

const U = '11111111-1111-1111-1111-111111111120';
const W = '99999999-9999-9999-9999-999999999920';
const F1 = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';

beforeEach(async () => {
  await sql`TRUNCATE audit_log, pages, files, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name) VALUES ('${U}', 'a@x', 'h', 'a');
    INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'w', 'w-${Date.now()}');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W}', '${U}', 'owner');
    INSERT INTO files (id, workspace_id, name, mime_type, size, path, uploaded_by)
      VALUES ('${F1}', '${W}', 'pic.png', 'image/png', 100, 'k/a.png', '${U}');
  `);
});

describe('extractAndRewriteAssets', () => {
  it('extracts image nodes + rewrites src to ./assets/<filename>', async () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: `/api/files/${F1}?sig=abc&exp=123` } },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
      ],
    };
    const { rewritten, assets } = await extractAndRewriteAssets(getDb(), W, doc);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.fileId).toBe(F1);
    expect(assets[0]?.destFilename).toMatch(/^[0-9a-f-]+-pic\.png$/);
    expect((rewritten as { content: { attrs: { src: string } }[] }).content[0]?.attrs.src).toBe(
      `./assets/${assets[0]!.destFilename}`,
    );
    expect(assets[0]?.storagePath).toBe('k/a.png');
  });

  it('returns empty assets for a doc with no media nodes', async () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }],
    };
    const { assets } = await extractAndRewriteAssets(getDb(), W, doc);
    expect(assets).toEqual([]);
  });

  it('drops cross-workspace asset refs silently', async () => {
    // Create another workspace with its own file; the doc references it.
    const W2 = '99999999-9999-9999-9999-999999999921';
    const U2 = '11111111-1111-1111-1111-111111111121';
    const F2 = 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
    await sql.unsafe(`
      INSERT INTO users (id, email, password_hash, name) VALUES ('${U2}', 'b@x', 'h', 'b');
      INSERT INTO workspaces (id, name, slug) VALUES ('${W2}', 'w2', 'w2-${Date.now()}');
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('${W2}', '${U2}', 'owner');
      INSERT INTO files (id, workspace_id, name, mime_type, size, path, uploaded_by)
        VALUES ('${F2}', '${W2}', 'foreign.png', 'image/png', 100, 'k/b.png', '${U2}');
    `);
    const doc = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: `/api/files/${F2}?sig=x&exp=1` } }],
    };
    const { assets } = await extractAndRewriteAssets(getDb(), W, doc);
    expect(assets).toEqual([]);
  });
});
