import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Visibility ACL for templates (v0.9 G4 P25).
 *
 * The viewer carries an explicit workspace identity (their currently-active
 * workspace) — gallery loaders pass it from the requireWorkspace context. We
 * never trust the workspace stored on the template row alone; for non-public
 * tiers the caller must also be a member of that workspace.
 *
 *  'private'   — visible only to members of the template's workspace. (When a
 *                future schema gains a created_by column the contract tightens
 *                to "viewer === creator"; until then 'private' is a UI tier
 *                hidden from cross-workspace access.)
 *  'workspace' — visible to any member of the template's workspace.
 *  'public'    — visible to any caller regardless of workspace; built-in rows
 *                (workspaceId IS NULL) also surface here.
 */

export type TemplateAccessArgs = {
  templateId: string;
  viewerUserId: string;
  viewerWorkspaceId: string;
};

export async function canReadTemplate(db: Db, args: TemplateAccessArgs): Promise<boolean> {
  const [tpl] = await db
    .select({
      visibility: schema.templates.visibility,
      workspaceId: schema.templates.workspaceId,
    })
    .from(schema.templates)
    .where(eq(schema.templates.id, args.templateId));
  if (!tpl) return false;
  if (tpl.visibility === 'public') return true;

  // 'private' + 'workspace' both require workspace membership on the template's
  // workspace. Built-in (workspaceId === null) rows are not private/workspace
  // by convention — they always carry visibility='public'.
  if (!tpl.workspaceId) return false;

  const [member] = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, tpl.workspaceId),
        eq(schema.workspaceMembers.userId, args.viewerUserId),
      ),
    );
  return Boolean(member);
}

export type ListVisibleArgs = {
  viewerUserId: string;
  viewerWorkspaceId: string;
};

/**
 * List every template visible to (viewerUserId, viewerWorkspaceId). Used by
 * the gallery server component. Combines:
 *
 *   - every 'public' row (regardless of workspace, including builtins where
 *     workspaceId IS NULL)
 *   - 'workspace' + 'private' rows belonging to a workspace the viewer is a
 *     member of
 */
export async function listVisibleTemplates(
  db: Db,
  args: ListVisibleArgs,
): Promise<schema.Template[]> {
  const memberRows = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, args.viewerUserId));
  const memberWorkspaces = memberRows.map((r) => r.workspaceId);

  const publicCondition = eq(schema.templates.visibility, 'public');
  const conditions = [publicCondition];
  if (memberWorkspaces.length > 0) {
    const memberCondition = and(
      inArray(schema.templates.workspaceId, memberWorkspaces),
      inArray(schema.templates.visibility, ['workspace', 'private']),
    );
    if (memberCondition) conditions.push(memberCondition);
  }
  // Builtins (workspaceId IS NULL) are always public — keep them in the
  // result set even when memberWorkspaces is empty.
  const builtinPublic = and(isNull(schema.templates.workspaceId), publicCondition);
  if (builtinPublic) conditions.push(builtinPublic);

  return db.select().from(schema.templates).where(or(...conditions));
}
