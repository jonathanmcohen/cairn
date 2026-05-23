import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ZipArchive } from 'archiver';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { getStorage } from '@/lib/files/get-storage';
import { databaseToCsv, databaseToJson, pageToJson, pageToMarkdown } from './renderers';

// archiver v8's `ZipArchive` export is module-augmented in
// src/lib/markdown/export-subtree.ts — that augmentation is global, so this
// file just imports it. Don't redeclare here or tsc throws TS2300.

/**
 * Produce a re-importable workspace archive: pages (JSON + MD), databases
 * (JSON + CSV), file blobs, and a manifest. SECRETS ARE EXCLUDED — no
 * api_keys, webhooks, user_totp, password hashes, or recovery codes. The
 * archive is safe to move between hosts and re-import into a fresh workspace
 * where new ids are minted (templates id-rewrite pass — Task 5 importer).
 */
export async function runWorkspaceExport(input: {
  workspaceId: string;
  outDir: string;
}): Promise<string> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for export');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    return await assemble(db, input);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function assemble(
  db: ReturnType<typeof drizzle<typeof schema>>,
  input: { workspaceId: string; outDir: string },
): Promise<string> {
  await mkdir(input.outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const zipPath = join(input.outDir, `cairn-export-${input.workspaceId}-${ts}.zip`);

  // Load workspace data (no secret-bearing tables).
  const pages = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.workspaceId, input.workspaceId));
  const databases = await db
    .select()
    .from(schema.databases)
    .where(eq(schema.databases.workspaceId, input.workspaceId));
  const files = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.workspaceId, input.workspaceId));

  // For each database load its properties + rows + cells.
  const dbBundles = await Promise.all(
    databases.map(async (d) => {
      const properties = await db
        .select()
        .from(schema.dbProperties)
        .where(eq(schema.dbProperties.databaseId, d.id));
      const rows = await db.select().from(schema.dbRows).where(eq(schema.dbRows.databaseId, d.id));
      const cells = await Promise.all(
        rows.map(async (r) => {
          const cs = await db.select().from(schema.dbCells).where(eq(schema.dbCells.rowId, r.id));
          const cellMap: Record<string, unknown> = {};
          for (const c of cs) cellMap[c.propertyId] = c.value;
          return { id: r.id, cells: cellMap };
        }),
      );
      return {
        id: d.id,
        name: d.name,
        properties: properties.map((p) => ({ id: p.id, name: p.name, type: p.type as string })),
        rows: cells,
      };
    }),
  );

  // Stream the archive.
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const out = createWriteStream(zipPath);
  const done = new Promise<void>((resolve, reject) => {
    out.on('close', () => resolve());
    archive.on('error', reject);
    archive.on('warning', (w) => {
      if (w.code !== 'ENOENT') reject(w);
    });
  });
  archive.pipe(out);

  for (const p of pages) {
    const shape = { id: p.id, title: p.title, content: p.content };
    archive.append(JSON.stringify(pageToJson(shape), null, 2), { name: `pages/${p.id}.json` });
    archive.append(pageToMarkdown(shape), { name: `pages/${p.id}.md` });
  }
  for (const d of dbBundles) {
    archive.append(JSON.stringify(databaseToJson(d), null, 2), { name: `databases/${d.id}.json` });
    archive.append(databaseToCsv(d), { name: `databases/${d.id}.csv` });
  }

  // File blobs from FileStorage. read() returns Readable synchronously.
  const storage = getStorage();
  for (const f of files) {
    try {
      const stream = storage.read(f.path);
      archive.append(stream, { name: `files/${f.path}` });
    } catch (err) {
      // Missing blob is logged but does not fail the export — the manifest
      // tells the importer this file existed at export time.
      console.warn(`[export] could not read blob ${f.path}: ${(err as Error).message}`);
    }
  }

  const manifest = {
    version: process.env.npm_package_version ?? 'unknown',
    exportedAt: new Date().toISOString(),
    workspaceId: input.workspaceId,
    counts: { pages: pages.length, databases: databases.length, files: files.length },
    format: 'cairn-workspace-archive@1',
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  await archive.finalize();
  await done;
  return zipPath;
}
