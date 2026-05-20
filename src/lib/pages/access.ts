import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import {
  type AuthContext,
  HttpError,
  type MemberRole,
  getAuthContext,
  hasMinRole,
} from '@/lib/auth/require-role';
import { eq } from 'drizzle-orm';

export type PageAccess = {
  page: schema.Page;
  ctx: AuthContext;
};

export async function requirePageAccess(pageId: string, required: MemberRole): Promise<PageAccess> {
  const ctx = await getAuthContext();
  if (!ctx) throw new HttpError(401, 'Not authenticated');

  const db = getDb();
  const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId)).limit(1);
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
