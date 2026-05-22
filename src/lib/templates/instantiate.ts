import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { collectDatabaseIds } from './capture';
import { TemplatePayloadSchema } from './payload';
import { buildRemap, rewriteRefs } from './rewrite';

type Db = PostgresJsDatabase<typeof schema>;

export type InstantiateInput = {
  templateId: string;
  targetWorkspaceId: string;
  createdBy: string;
  parentId?: string | null; // where to graft the root page (null = top level)
};

export type InstantiateResult = { rootPageId?: string; rootDatabaseId?: string };

export async function instantiateTemplate(
  db: Db,
  input: InstantiateInput,
): Promise<InstantiateResult> {
  const [tpl] = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, input.templateId))
    .limit(1);
  if (!tpl) throw new Error('template not found');
  // built-in (workspaceId null) is usable from anywhere; workspace templates are
  // visible to their own workspace — callers gate access before calling this.
  const payload = TemplatePayloadSchema.parse(tpl.payload);
  const remap = buildRemap(payload);
  const rewritten = rewriteRefs(payload, remap);

  return db.transaction(async (tx) => {
    // Which (new) page hosts each (new) database, derived from content nodes.
    const hostPageByDb = new Map<string, string>();
    for (const page of rewritten.pages) {
      for (const dbId of collectDatabaseIds(page.content)) hostPageByDb.set(dbId, page.id);
    }

    // 1. Pages. The root's parent becomes the caller-supplied parentId.
    const rootId = rewritten.rootPageId ?? null;
    for (const page of rewritten.pages) {
      const isRoot = page.id === rootId;
      await tx.insert(schema.pages).values({
        id: page.id,
        workspaceId: input.targetWorkspaceId,
        parentId: isRoot ? (input.parentId ?? null) : page.parentId,
        title: page.title,
        icon: page.icon,
        content: page.content as never,
        createdBy: input.createdBy,
      } as never);
    }

    // 2. Databases. Each needs a host page. For a `database`-kind payload (no
    //    pages), mint a host page so the FK to pages is satisfied.
    let rootDatabaseId: string | undefined;
    for (const database of rewritten.databases) {
      let pageId = hostPageByDb.get(database.id);
      if (!pageId) {
        pageId = randomUUID();
        await tx.insert(schema.pages).values({
          id: pageId,
          workspaceId: input.targetWorkspaceId,
          parentId: input.parentId ?? null,
          title: database.name,
          icon: null,
          content: {
            type: 'doc',
            content: [{ type: 'database', attrs: { databaseId: database.id } }],
          } as never,
          createdBy: input.createdBy,
        } as never);
        rootDatabaseId = database.id;
      }
      await tx.insert(schema.databases).values({
        id: database.id,
        workspaceId: input.targetWorkspaceId,
        pageId,
        name: database.name,
        createdBy: input.createdBy,
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
          createdBy: input.createdBy,
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

    return {
      rootPageId: rootId ?? undefined,
      rootDatabaseId: rewritten.rootDatabaseId ?? rootDatabaseId,
    };
  });
}
