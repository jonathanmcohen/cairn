import { randomBytes } from 'node:crypto';
import * as schema from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** Lowercase, replace non-alphanumerics with single hyphens, trim, fall back to "page". */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'page';
}

type Scope = { pageId: string; workspaceId: string };

async function loadScoped(db: PostgresJsDatabase<typeof schema>, scope: Scope) {
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
 */
export async function publishPage(
  db: PostgresJsDatabase<typeof schema>,
  scope: Scope,
): Promise<{ slug: string }> {
  const page = await loadScoped(db, scope);
  const slug = page.publicSlug ?? `${slugify(page.title)}-${randomBytes(3).toString('hex')}`;
  await db
    .update(schema.pages)
    .set({ published: true, publicSlug: slug })
    .where(eq(schema.pages.id, page.id));
  return { slug };
}

/** Mark a page unpublished. Retains `public_slug` so re-publishing reuses the same URL. */
export async function unpublishPage(
  db: PostgresJsDatabase<typeof schema>,
  scope: Scope,
): Promise<void> {
  await loadScoped(db, scope);
  await db.update(schema.pages).set({ published: false }).where(eq(schema.pages.id, scope.pageId));
}
