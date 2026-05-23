import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

/** Lowercase, replace non-alphanumerics with single hyphens, trim, fall back to "page". */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'page';
}

type Scope = { pageId: string; workspaceId: string };
type AuditedScope = Scope & { actorUserId: string };

async function loadScoped(
  db: PostgresJsDatabase<typeof schema>,
  scope: Scope,
): Promise<schema.Page> {
  const [page] = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.id, scope.pageId), eq(schema.pages.workspaceId, scope.workspaceId)))
    .limit(1);
  if (!page) throw new Error('page not found in workspace');
  return page;
}

/**
 * Mark a page published. Mints `public_slug` (`<slugify(title)>-<6 hex>`) on first
 * publish; reuses the existing slug on re-publish. Returns the slug.
 *
 * Wraps the mutation + `page.published` audit row in a single transaction so the
 * audit can never drift from the action (spec §2.27).
 */
export async function publishPage(
  db: PostgresJsDatabase<typeof schema>,
  scope: AuditedScope,
): Promise<{ slug: string }> {
  return db.transaction(async (tx) => {
    const page = await loadScoped(tx, scope);
    const slug = page.publicSlug ?? `${slugify(page.title)}-${randomBytes(3).toString('hex')}`;
    await tx
      .update(schema.pages)
      .set({ published: true, publicSlug: slug })
      .where(eq(schema.pages.id, page.id));
    await recordAudit(tx, {
      workspaceId: scope.workspaceId,
      actorUserId: scope.actorUserId,
      action: 'page.published',
      targetType: 'page',
      targetId: page.id,
    });
    return { slug };
  });
}

/**
 * Mark a page unpublished. Retains `public_slug` so re-publishing reuses the same URL.
 * Wraps the mutation + `page.unpublished` audit row in a single transaction.
 */
export async function unpublishPage(
  db: PostgresJsDatabase<typeof schema>,
  scope: AuditedScope,
): Promise<void> {
  await db.transaction(async (tx) => {
    await loadScoped(tx, scope);
    await tx
      .update(schema.pages)
      .set({ published: false })
      .where(eq(schema.pages.id, scope.pageId));
    await recordAudit(tx, {
      workspaceId: scope.workspaceId,
      actorUserId: scope.actorUserId,
      action: 'page.unpublished',
      targetType: 'page',
      targetId: scope.pageId,
    });
  });
}
