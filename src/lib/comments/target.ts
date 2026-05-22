import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';

/** Enum string values stored in `comments.target_type` (matches the DB enum). */
export const COMMENT_TARGET_TYPES = ['page', 'db_row', 'file'] as const;
export type CommentTargetType = (typeof COMMENT_TARGET_TYPES)[number];

/** The polymorphic thread subject: a type tag + the id of that entity. */
export const CommentTargetSchema = z
  .object({
    type: z.enum(COMMENT_TARGET_TYPES),
    id: z.uuid(),
  })
  .strict();

export type CommentTarget = z.infer<typeof CommentTargetSchema>;

/** Validated target with the page id to denormalize onto the comment row. */
export type ResolvedTarget = { type: CommentTargetType; id: string; pageId: string | null };

/**
 * Validate that `target` exists in `workspaceId` and return the owning page id
 * (= the target id for pages, the owning database's page for rows, the file's
 * page for files — may be null). Cross-workspace / missing → HttpError(404),
 * mirroring requirePageAccess's existence-non-leak rule.
 */
export async function resolveTarget(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  target: CommentTarget,
): Promise<ResolvedTarget> {
  if (target.type === 'page') {
    const [page] = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, target.id),
          eq(schema.pages.workspaceId, workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!page) throw new HttpError(404, 'Target not found');
    return { type: 'page', id: page.id, pageId: page.id };
  }

  if (target.type === 'db_row') {
    const [row] = await db
      .select({ rowId: schema.dbRows.id, pageId: schema.databases.pageId })
      .from(schema.dbRows)
      .innerJoin(schema.databases, eq(schema.dbRows.databaseId, schema.databases.id))
      .where(and(eq(schema.dbRows.id, target.id), eq(schema.databases.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new HttpError(404, 'Target not found');
    return { type: 'db_row', id: row.rowId, pageId: row.pageId };
  }

  // file
  const [file] = await db
    .select({ id: schema.files.id, pageId: schema.files.pageId })
    .from(schema.files)
    .where(and(eq(schema.files.id, target.id), eq(schema.files.workspaceId, workspaceId)))
    .limit(1);
  if (!file) throw new HttpError(404, 'Target not found');
  return { type: 'file', id: file.id, pageId: file.pageId };
}
