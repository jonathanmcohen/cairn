import { asc, eq, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { TemplateDatabase, TemplatePayload } from './payload';

type Db = PostgresJsDatabase<typeof schema>;

/** Recursively collect every `database` node's `databaseId` from a content doc. */
export function collectDatabaseIds(content: unknown, out: Set<string> = new Set()): Set<string> {
  if (!content || typeof content !== 'object') return out;
  const node = content as { type?: string; attrs?: { databaseId?: unknown }; content?: unknown[] };
  if (node.type === 'database' && typeof node.attrs?.databaseId === 'string') {
    out.add(node.attrs.databaseId);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectDatabaseIds(child, out);
  }
  return out;
}

/** Capture a single database (properties + views, rows only when requested). */
async function captureDatabaseInto(
  db: Db,
  databaseId: string,
  withSampleRows: boolean,
): Promise<TemplateDatabase> {
  const [database] = await db
    .select({ id: schema.databases.id, name: schema.databases.name })
    .from(schema.databases)
    .where(eq(schema.databases.id, databaseId))
    .limit(1);
  if (!database) throw new Error(`database ${databaseId} not found`);

  const properties = await db
    .select({
      id: schema.dbProperties.id,
      name: schema.dbProperties.name,
      type: schema.dbProperties.type,
      config: schema.dbProperties.config,
      position: schema.dbProperties.position,
    })
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, databaseId))
    .orderBy(asc(schema.dbProperties.position));

  const views = await db
    .select({
      id: schema.dbViews.id,
      type: schema.dbViews.type,
      name: schema.dbViews.name,
      config: schema.dbViews.config,
      position: schema.dbViews.position,
    })
    .from(schema.dbViews)
    .where(eq(schema.dbViews.databaseId, databaseId))
    .orderBy(asc(schema.dbViews.position));

  let rows: TemplateDatabase['rows'] = [];
  if (withSampleRows) {
    const rowRows = await db
      .select({ id: schema.dbRows.id })
      .from(schema.dbRows)
      .where(eq(schema.dbRows.databaseId, databaseId))
      .orderBy(asc(schema.dbRows.createdAt));
    rows = await Promise.all(
      rowRows.map(async (r) => {
        const cells = await db
          .select({ propertyId: schema.dbCells.propertyId, value: schema.dbCells.value })
          .from(schema.dbCells)
          .where(eq(schema.dbCells.rowId, r.id));
        return { id: r.id, cells };
      }),
    );
  }

  return { id: database.id, name: database.name, properties, views, rows };
}

/** Capture a page subtree + every database embedded in its content. */
export async function capturePage(
  db: Db,
  args: { workspaceId: string; rootPageId: string },
): Promise<TemplatePayload> {
  const pageRows = (await db.execute(rawSql`
    WITH RECURSIVE tree AS (
      SELECT id, parent_id, title, icon, content FROM pages
      WHERE workspace_id = ${args.workspaceId}::uuid
        AND id = ${args.rootPageId}::uuid
        AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.parent_id, p.title, p.icon, p.content FROM pages p
      INNER JOIN tree t ON p.parent_id = t.id
      WHERE p.workspace_id = ${args.workspaceId}::uuid
        AND p.deleted_at IS NULL
    )
    SELECT id, parent_id, title, icon, content FROM tree;
  `)) as unknown as {
    id: string;
    parent_id: string | null;
    title: string;
    icon: string | null;
    content: unknown;
  }[];
  if (pageRows.length === 0) throw new Error('root page not found in workspace');

  const capturedPageIds = new Set(pageRows.map((p) => p.id));
  const pages = pageRows.map((p) => ({
    id: p.id,
    // a parent outside the captured subtree (the root's own parent) becomes null
    parentId: p.parent_id && capturedPageIds.has(p.parent_id) ? p.parent_id : null,
    title: p.title,
    icon: p.icon,
    content: p.content,
  }));

  const databaseIds = new Set<string>();
  for (const p of pageRows) collectDatabaseIds(p.content, databaseIds);
  const databases = await Promise.all(
    [...databaseIds].map((id) => captureDatabaseInto(db, id, false)),
  );

  return { kind: 'page', rootPageId: args.rootPageId, pages, databases };
}

/** Capture a standalone database as a `database`-kind payload. */
export async function captureDatabase(
  db: Db,
  args: { workspaceId: string; databaseId: string; withSampleRows?: boolean },
): Promise<TemplatePayload> {
  const [owner] = await db
    .select({ workspaceId: schema.databases.workspaceId })
    .from(schema.databases)
    .where(eq(schema.databases.id, args.databaseId))
    .limit(1);
  if (!owner || owner.workspaceId !== args.workspaceId) {
    throw new Error('database not found in workspace');
  }
  const database = await captureDatabaseInto(db, args.databaseId, args.withSampleRows ?? false);
  return { kind: 'database', rootDatabaseId: args.databaseId, pages: [], databases: [database] };
}
