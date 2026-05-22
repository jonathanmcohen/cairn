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

/**
 * Postgres `uuid` columns reject non-UUID input with a cast error. Validate the
 * id shape up front so a malformed `pageId` resolves to a clean 404 (matching
 * the cross-workspace convention) instead of surfacing a 500 / raw DB error.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requirePageAccess(pageId: string, required: MemberRole): Promise<PageAccess> {
  const ctx = requireWorkspace(await getAuthContext());

  if (!UUID_RE.test(pageId)) {
    // Not a valid id → treat as not-found; never let it reach the uuid column.
    throw new HttpError(404, 'Page not found');
  }

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
