import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { captureDatabase, capturePage } from './capture';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Capture a page subtree as a reusable template. The insert + the
 * `template.created` audit row are written in a single transaction so the
 * audit can never drift from the action (spec §2.27). Audit metadata records
 * only `{name, kind}` — never the captured payload.
 */
export async function savePageAsTemplate(
  db: Db,
  input: { workspaceId: string; actorUserId: string; rootPageId: string; name: string },
): Promise<schema.Template> {
  const payload = await capturePage(db, {
    workspaceId: input.workspaceId,
    rootPageId: input.rootPageId,
  });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.templates)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        kind: 'page',
        payload,
        builtIn: false,
      })
      .returning();
    if (!row) throw new Error('failed to save template');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'template.created',
      targetType: 'template',
      targetId: row.id,
      metadata: { name: input.name, kind: 'page' },
    });
    return row;
  });
}

/**
 * Capture a database as a reusable template. The insert + the `template.created`
 * audit row are written in a single transaction so the audit can never drift
 * from the action.
 */
export async function saveDatabaseAsTemplate(
  db: Db,
  input: {
    workspaceId: string;
    actorUserId: string;
    databaseId: string;
    name: string;
    withSampleRows?: boolean;
  },
): Promise<schema.Template> {
  const payload = await captureDatabase(db, {
    workspaceId: input.workspaceId,
    databaseId: input.databaseId,
    withSampleRows: input.withSampleRows,
  });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.templates)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        kind: 'database',
        payload,
        builtIn: false,
      })
      .returning();
    if (!row) throw new Error('failed to save template');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'template.created',
      targetType: 'template',
      targetId: row.id,
      metadata: { name: input.name, kind: 'database' },
    });
    return row;
  });
}
