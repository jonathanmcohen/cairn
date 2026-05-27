import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { captureDatabase, capturePage } from './capture';

type Db = PostgresJsDatabase<typeof schema>;

const VISIBILITY = z.enum(schema.TEMPLATE_VISIBILITIES);

export type SavePageAsTemplateInput = {
  workspaceId: string;
  actorUserId: string;
  rootPageId: string;
  name: string;
  /** v0.9 G4 P25 — sharing tier (private/workspace/public). */
  visibility: schema.TemplateVisibility;
};

/**
 * Capture a page subtree as a reusable template. The insert + the
 * `template.created` audit row are written in a single transaction so the
 * audit can never drift from the action (spec §2.27). Audit metadata records
 * `{name, kind, visibility}` — never the captured payload.
 *
 * v0.9 G4 P25: accepts a `visibility` argument (persisted in templates.visibility,
 * added by migration 0048 shared with P24). The visibility is validated up
 * front before the capture walk so a bad string fails fast.
 */
export async function savePageAsTemplate(
  db: Db,
  input: SavePageAsTemplateInput,
): Promise<schema.Template> {
  VISIBILITY.parse(input.visibility);
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
        visibility: input.visibility,
      })
      .returning();
    if (!row) throw new Error('failed to save template');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'template.created',
      targetType: 'template',
      targetId: row.id,
      metadata: { name: input.name, kind: 'page', visibility: input.visibility },
    });
    return row;
  });
}

/**
 * Capture a database as a reusable template. The insert + the `template.created`
 * audit row are written in a single transaction so the audit can never drift
 * from the action. Database templates default to visibility='workspace' —
 * v0.9 G4 P25 did not extend the database-template UX with a visibility
 * selector.
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
        visibility: 'workspace',
      })
      .returning();
    if (!row) throw new Error('failed to save template');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'template.created',
      targetType: 'template',
      targetId: row.id,
      metadata: { name: input.name, kind: 'database', visibility: 'workspace' },
    });
    return row;
  });
}
