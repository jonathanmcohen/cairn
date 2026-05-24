import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { instantiateTemplate } from '@/lib/templates/instantiate';
import { type ActionContext, applyTemplate, BadConfigError } from './index';

/**
 * Create-page action. action_config = { templateId, parentId?, titleTemplate? }.
 * Instantiates the template under parentId (or top level), then optionally
 * rewrites the new root page's title using `titleTemplate` with mustache-lite
 * substitution against the trigger payload.
 *
 * `createdBy` fallback: rule.createdBy is `set null` on user delete, but
 * `instantiateTemplate` requires a non-null FK. When ctx.createdBy is null we
 * fall back to the workspace owner (workspace_members.role='owner').
 */
export async function runCreatePage(
  config: Record<string, unknown>,
  payload: unknown,
  ctx: ActionContext,
): Promise<void> {
  const templateId = typeof config.templateId === 'string' ? config.templateId : null;
  if (!templateId) {
    throw new BadConfigError('create_page: templateId is required');
  }
  const parentId = typeof config.parentId === 'string' ? config.parentId : null;
  const titleTemplate = typeof config.titleTemplate === 'string' ? config.titleTemplate : null;

  const db = getDb();
  let createdBy = ctx.createdBy;
  if (!createdBy) {
    const [owner] = await db
      .select({ userId: schema.workspaceMembers.userId })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, ctx.workspaceId),
          eq(schema.workspaceMembers.role, 'owner'),
        ),
      )
      .limit(1);
    if (!owner) {
      throw new Error(`create_page: workspace ${ctx.workspaceId} has no owner to attribute to`);
    }
    createdBy = owner.userId;
  }

  const { rootPageId } = await instantiateTemplate(db, {
    templateId,
    targetWorkspaceId: ctx.workspaceId,
    createdBy,
    parentId,
  });

  if (rootPageId && titleTemplate) {
    const title = applyTemplate(titleTemplate, payload);
    await db.update(schema.pages).set({ title }).where(eq(schema.pages.id, rootPageId));
  }
}
