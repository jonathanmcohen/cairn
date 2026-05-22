import { hash, verify } from '@node-rs/argon2';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Scope = { pageId: string; workspaceId: string };

type ShareSettings = Scope & {
  /** undefined = leave unchanged; null = clear; string = (re)hash. */
  password?: string | null;
  /** undefined = leave unchanged; null = clear; Date = set. */
  expiresAt?: Date | null;
  allowDuplication?: boolean;
};

async function loadScoped(db: PostgresJsDatabase<typeof schema>, scope: Scope) {
  const [page] = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.id, scope.pageId), eq(schema.pages.workspaceId, scope.workspaceId)))
    .limit(1);
  if (!page) throw new Error('page not found in workspace');
  return page;
}

/** Persist per-page share settings. Argon2id-hashes a provided password; null clears it. */
export async function setShareSettings(
  db: PostgresJsDatabase<typeof schema>,
  s: ShareSettings,
): Promise<void> {
  await loadScoped(db, s);
  const patch: Partial<typeof schema.pages.$inferInsert> = {};
  if (s.password !== undefined) {
    patch.linkPasswordHash = s.password === null ? null : await hash(s.password);
  }
  if (s.expiresAt !== undefined) patch.expiresAt = s.expiresAt;
  if (s.allowDuplication !== undefined) patch.allowDuplication = s.allowDuplication;
  if (Object.keys(patch).length > 0) {
    await db.update(schema.pages).set(patch).where(eq(schema.pages.id, s.pageId));
  }
}

/** Argon2id-verify a candidate password against a page's stored hash. */
export async function verifyShareAccess(
  page: Pick<schema.Page, 'linkPasswordHash'>,
  candidate: string,
): Promise<boolean> {
  if (!page.linkPasswordHash) return false;
  try {
    return await verify(page.linkPasswordHash, candidate);
  } catch {
    return false;
  }
}

export type PublicAccess =
  | { ok: true; page: schema.Page }
  | { ok: 'gate'; page: schema.Page }
  | { ok: false };

/**
 * The single public-render authorization gate. Resolves a slug to a published,
 * non-deleted, non-expired page. Expired/unpublished/deleted/unknown → { ok: false }
 * (the route maps ALL of these to notFound() — never 403). A password-protected page
 * without a valid access cookie → { ok: 'gate' }. Otherwise { ok: true }.
 */
export async function requirePublicPageAccess(
  db: PostgresJsDatabase<typeof schema>,
  slug: string,
  hasValidCookie: boolean,
): Promise<PublicAccess> {
  const [page] = await db
    .select()
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.publicSlug, slug),
        eq(schema.pages.published, true),
        isNull(schema.pages.deletedAt),
      ),
    )
    .limit(1);
  if (!page) return { ok: false };
  if (page.expiresAt && page.expiresAt.getTime() <= Date.now()) return { ok: false };
  if (page.linkPasswordHash && !hasValidCookie) return { ok: 'gate', page };
  return { ok: true, page };
}
