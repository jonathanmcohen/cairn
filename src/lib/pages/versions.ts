import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

/** Skip a snapshot if the latest version is younger than this (keystroke debounce). */
export const SNAPSHOT_DEBOUNCE_MS = 60_000;
/** Retain at most this many versions per page; older ones are pruned. */
export const MAX_VERSIONS_PER_PAGE = 50;

export type SnapshotInput = {
  pageId: string;
  content: unknown;
  authorId: string | null;
};

/**
 * Stable JSON string with object keys sorted recursively. Postgres `jsonb`
 * does NOT preserve object key insertion order, so a naive `JSON.stringify`
 * of the stored content can differ from the incoming content even when they
 * are logically equal. Canonicalizing makes the dedupe order-independent.
 */
function canonicalJson(value: unknown): string {
  const seen = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(seen);
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) out[k] = seen(obj[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(seen(value));
}

/**
 * Insert a new page_versions row IFF either no version exists yet, or the
 * latest is older than SNAPSHOT_DEBOUNCE_MS AND its content differs from the
 * incoming content. After inserting, prune beyond MAX_VERSIONS_PER_PAGE.
 * Returns the inserted row, or null when skipped. Never throws on a no-op.
 */
export async function snapshotIfChanged(
  db: PostgresJsDatabase<typeof schema>,
  input: SnapshotInput,
  opts: { force?: boolean } = {},
): Promise<schema.PageVersion | null> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select()
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.pageId, input.pageId))
      .orderBy(desc(schema.pageVersions.createdAt))
      .limit(1);

    if (latest) {
      const age = Date.now() - latest.createdAt.getTime();
      // A deliberate user action ("Save snapshot now") forces past the
      // time-debounce; the content-dedupe still applies so we never write a
      // duplicate version. The PATCH caller passes no opts, so its behavior is
      // unchanged (debounce + dedupe).
      if (!opts.force && age < SNAPSHOT_DEBOUNCE_MS) return null; // too soon
      if (canonicalJson(latest.content) === canonicalJson(input.content)) return null; // unchanged
    }

    const [inserted] = await tx
      .insert(schema.pageVersions)
      .values({
        pageId: input.pageId,
        content: input.content as never,
        authorId: input.authorId,
      })
      .returning();

    // Prune: delete rows for this page NOT among the newest MAX_VERSIONS_PER_PAGE ids.
    const keep = tx
      .select({ id: schema.pageVersions.id })
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.pageId, input.pageId))
      .orderBy(desc(schema.pageVersions.createdAt))
      .limit(MAX_VERSIONS_PER_PAGE);
    await tx
      .delete(schema.pageVersions)
      .where(
        and(eq(schema.pageVersions.pageId, input.pageId), notInArray(schema.pageVersions.id, keep)),
      );

    return inserted ?? null;
  });
}

export type VersionListItem = schema.PageVersion & { authorName: string | null };

/** Versions for a page, newest-first, with the author's display name. */
export async function listVersions(
  db: PostgresJsDatabase<typeof schema>,
  pageId: string,
): Promise<VersionListItem[]> {
  const rows = await db
    .select({
      version: schema.pageVersions,
      authorName: schema.users.name,
    })
    .from(schema.pageVersions)
    .leftJoin(schema.users, eq(schema.users.id, schema.pageVersions.authorId))
    .where(eq(schema.pageVersions.pageId, pageId))
    .orderBy(desc(schema.pageVersions.createdAt));
  return rows.map((r) => ({ ...r.version, authorName: r.authorName ?? null }));
}

/**
 * Non-destructive restore: copy the chosen version's content onto the live
 * page AND record it as a brand-new version. History is append-only.
 *
 * The page update + new-version insert + the `page.version_restored` audit row
 * are written in a single transaction so the audit can never drift from the
 * action (spec §2.27). Pass `workspaceId` so the audit row lands in the right
 * tenant; the route layer has already verified ownership of the version.
 */
export async function restoreVersion(
  db: PostgresJsDatabase<typeof schema>,
  input: { versionId: string; workspaceId: string; actorUserId: string },
): Promise<schema.PageVersion> {
  return db.transaction(async (tx) => {
    const [chosen] = await tx
      .select()
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.id, input.versionId))
      .limit(1);
    if (!chosen) throw new Error('Version not found');

    await tx
      .update(schema.pages)
      .set({ content: chosen.content as never })
      .where(eq(schema.pages.id, chosen.pageId));

    const [newVersion] = await tx
      .insert(schema.pageVersions)
      .values({
        pageId: chosen.pageId,
        content: chosen.content as never,
        authorId: chosen.authorId,
      })
      .returning();
    if (!newVersion) throw new Error('Restore insert returned no row');

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'page.version_restored',
      targetType: 'page',
      targetId: chosen.pageId,
      metadata: { versionId: input.versionId },
    });

    return newVersion;
  });
}
