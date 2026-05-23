import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { getStorage } from '@/lib/files/get-storage';
import { collectDatabaseIds } from '@/lib/templates/capture';
import type { TemplatePayload } from '@/lib/templates/payload';
import { importMarkdownFolder } from './markdown-folder';
import { importNotion } from './notion';
import type { ImportReport } from './report';
import { importWorkspaceArchive } from './workspace-archive';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export type RunImportInput = {
  source: 'notion' | 'markdown-folder' | 'workspace-archive';
  file: string;
  workspaceId: string;
  actorUserId: string;
};

/**
 * Top-level import dispatcher: opens a DB connection, records an
 * `import_jobs` row, invokes the source-specific importer, persists the
 * resulting payload, and marks the job completed (or failed).
 */
export async function runImport(input: RunImportInput): Promise<ImportReport> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for import');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    return await runImportWithDb(db, input);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runImportWithDb(db: Db, input: RunImportInput): Promise<ImportReport> {
  const [job] = await db
    .insert(schema.importJobs)
    .values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      source: input.source,
      status: 'running',
      report: {},
    })
    .returning();
  if (!job) throw new Error('failed to create import_jobs row');

  try {
    let payload: TemplatePayload;
    let report: ImportReport;
    let blobs: Map<string, Buffer> | null = null;

    if (input.source === 'workspace-archive') {
      const result = await importWorkspaceArchive(input.file);
      payload = result.payload;
      report = result.report;
      blobs = result.blobs;
    } else if (input.source === 'notion') {
      const files = await readMarkdownTree(input.file);
      const result = importNotion({ files });
      payload = result.payload;
      report = result.report;
    } else {
      const files = await readMarkdownTree(input.file);
      const result = importMarkdownFolder({ files });
      payload = result.payload;
      report = result.report;
    }

    await persistImportPayload(db, input.workspaceId, payload, input.actorUserId);

    if (blobs) {
      const storage = getStorage();
      for (const [path, buf] of blobs.entries()) {
        try {
          await storage.put(path, buf, 'application/octet-stream');
        } catch (err) {
          report.warnings.push({
            item: path,
            message: `failed to re-host file blob: ${(err as Error).message}`,
          });
        }
      }
    }

    await db
      .update(schema.importJobs)
      .set({ status: 'completed', report, completedAt: new Date() })
      .where(eq(schema.importJobs.id, job.id));
    return report;
  } catch (err) {
    await db
      .update(schema.importJobs)
      .set({
        status: 'failed',
        report: { error: (err as Error).message },
        completedAt: new Date(),
      })
      .where(eq(schema.importJobs.id, job.id));
    throw err;
  }
}

/**
 * Read `.md` files from a path. If the path is a single .md file, returns
 * that file; if it's a directory, walks recursively. (We don't expand ZIPs
 * here — Notion exports are typically a ZIP the caller has unpacked; the
 * test exercises the file-list path via importNotion directly.)
 */
async function readMarkdownTree(
  pathOrFile: string,
): Promise<Array<{ path: string; content: string }>> {
  const { stat, readdir } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');
  const st = await stat(pathOrFile);
  if (st.isFile()) {
    const content = (await readFile(pathOrFile)).toString('utf-8');
    return [{ path: pathOrFile.replace(/^.*\//, ''), content }];
  }
  const out: Array<{ path: string; content: string }> = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.md')) {
        const content = (await readFile(full)).toString('utf-8');
        out.push({ path: relative(pathOrFile, full), content });
      }
    }
  }
  await walk(pathOrFile);
  return out;
}

/**
 * Insert the (already-remapped) payload into the target workspace. Mirrors
 * `instantiateTemplate` but inserts pages at top-level (parentId unchanged
 * from the payload, which is null for roots), without needing a template
 * row.
 */
async function persistImportPayload(
  db: Db,
  workspaceId: string,
  payload: TemplatePayload,
  actorUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Map (new) database id → host page id, derived from content nodes.
    const hostPageByDb = new Map<string, string>();
    for (const page of payload.pages) {
      for (const dbId of collectDatabaseIds(page.content)) hostPageByDb.set(dbId, page.id);
    }

    // 1. Pages.
    for (const page of payload.pages) {
      await tx.insert(schema.pages).values({
        id: page.id,
        workspaceId,
        parentId: page.parentId,
        title: page.title,
        icon: page.icon,
        content: page.content as never,
        createdBy: actorUserId,
      } as never);
    }

    // 2. Databases. If no host page, mint one (workspace-archive paths
    //    where the database wasn't embedded in any page).
    for (const database of payload.databases) {
      let pageId = hostPageByDb.get(database.id);
      if (!pageId) {
        const { randomUUID } = await import('node:crypto');
        pageId = randomUUID();
        await tx.insert(schema.pages).values({
          id: pageId,
          workspaceId,
          parentId: null,
          title: database.name,
          icon: null,
          content: {
            type: 'doc',
            content: [{ type: 'database', attrs: { databaseId: database.id } }],
          } as never,
          createdBy: actorUserId,
        } as never);
      }
      await tx.insert(schema.databases).values({
        id: database.id,
        workspaceId,
        pageId,
        name: database.name,
        createdBy: actorUserId,
      } as never);
      if (database.properties.length) {
        await tx.insert(schema.dbProperties).values(
          database.properties.map((pr) => ({
            id: pr.id,
            databaseId: database.id,
            name: pr.name,
            type: pr.type as schema.PropertyType,
            config: pr.config as never,
            position: pr.position,
          })) as never,
        );
      }
      if (database.views.length) {
        await tx.insert(schema.dbViews).values(
          database.views.map((v) => ({
            id: v.id,
            databaseId: database.id,
            type: v.type as schema.ViewType,
            name: v.name,
            config: v.config as never,
            position: v.position,
          })) as never,
        );
      }
      for (const row of database.rows) {
        await tx.insert(schema.dbRows).values({
          id: row.id,
          databaseId: database.id,
          createdBy: actorUserId,
        } as never);
        if (row.cells.length) {
          await tx.insert(schema.dbCells).values(
            row.cells.map((c) => ({
              rowId: row.id,
              propertyId: c.propertyId,
              value: c.value,
            })) as never,
          );
        }
      }
    }
  });
}
