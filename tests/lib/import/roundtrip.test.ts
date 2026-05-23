import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { runWorkspaceExport } from '@/lib/export/workspace-archive';
import { runImport } from '@/lib/import/run';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let tmpDir: string;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  tmpDir = join(tmpdir(), `cairn-roundtrip-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
  await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`TRUNCATE pages, databases, workspaces, users, workspace_members, import_jobs RESTART IDENTITY CASCADE`;
});

describe('workspace export → import round-trip', () => {
  it('exports a workspace and re-imports it into a fresh one with new ids', async () => {
    const [u] = await db
      .insert(schema.users)
      .values({ email: 'u@x.com', passwordHash: 'h', name: 'U' })
      .returning();
    if (!u) throw new Error('no user');
    const [src] = await db
      .insert(schema.workspaces)
      .values({ name: 'Src', slug: 'src' })
      .returning();
    const [dst] = await db
      .insert(schema.workspaces)
      .values({ name: 'Dst', slug: 'dst' })
      .returning();
    if (!src || !dst) throw new Error('no workspaces');
    await db.insert(schema.workspaceMembers).values([
      { workspaceId: src.id, userId: u.id, role: 'owner' },
      { workspaceId: dst.id, userId: u.id, role: 'owner' },
    ]);
    const [page] = await db
      .insert(schema.pages)
      .values({
        workspaceId: src.id,
        title: 'Hello',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'world' }] }],
        },
        createdBy: u.id,
      })
      .returning();
    if (!page) throw new Error('no page');

    const zip = await runWorkspaceExport({ workspaceId: src.id, outDir: tmpDir });
    expect(zip).toMatch(/cairn-export-/);

    const report = await runImport({
      source: 'workspace-archive',
      file: zip,
      workspaceId: dst.id,
      actorUserId: u.id,
    });
    expect(report.counts.pages).toBe(1);

    const dstPages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, dst.id));
    expect(dstPages).toHaveLength(1);
    expect(dstPages[0]!.title).toBe('Hello');
    expect(dstPages[0]!.id).not.toBe(page.id);
  });
});
