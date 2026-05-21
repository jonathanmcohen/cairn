import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import {
  getAuthContext,
  HttpError,
  hasMinRole,
  type MemberRole,
  requireWorkspace,
  type WorkspaceContext,
} from '@/lib/auth/require-role';

export type PageAccess = {
  page: schema.Page;
  ctx: WorkspaceContext;
};

export async function requirePageAccess(pageId: string, required: MemberRole): Promise<PageAccess> {
  const ctx = requireWorkspace(await getAuthContext());

  const db = getDb();
  const [page] = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.id, pageId), isNull(schema.pages.deletedAt)))
    .limit(1);
  if (!page) throw new HttpError(404, 'Page not found');
  if (page.workspaceId !== ctx.workspaceId) {
    // Same status as not-found to avoid leaking page existence across workspaces.
    throw new HttpError(404, 'Page not found');
  }
  if (!hasMinRole(ctx.role, required)) {
    throw new HttpError(403, `Requires role ${required}`);
  }
  return { page, ctx };
}
