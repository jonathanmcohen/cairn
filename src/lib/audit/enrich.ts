import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;
type AuditRow = typeof schema.auditLog.$inferSelect;

export type EnrichedAuditEntry = AuditRow & {
  /** Resolved actor display name, or null for system / deleted-user actions. */
  actorName: string | null;
  /** Resolved human title for the target entity, or null when unresolved. */
  targetTitle: string | null;
  /** In-app href for the target when one exists (pages only), else null. */
  targetHref: string | null;
};

export async function enrichAuditEntries(db: Db, rows: AuditRow[]): Promise<EnrichedAuditEntry[]> {
  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const found = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, actorIds));
    for (const u of found) actorNames.set(u.id, u.name);
  }

  const pageIds = [
    ...new Set(
      rows.filter((r) => r.targetType === 'page' && r.targetId).map((r) => r.targetId as string),
    ),
  ];
  const dbIds = [
    ...new Set(
      rows
        .filter((r) => r.targetType === 'database' && r.targetId)
        .map((r) => r.targetId as string),
    ),
  ];
  const pageTitles = new Map<string, string>();
  if (pageIds.length > 0) {
    const found = await db
      .select({ id: schema.pages.id, title: schema.pages.title })
      .from(schema.pages)
      .where(inArray(schema.pages.id, pageIds));
    for (const p of found) pageTitles.set(p.id, p.title);
  }
  const dbNames = new Map<string, string>();
  if (dbIds.length > 0) {
    const found = await db
      .select({ id: schema.databases.id, name: schema.databases.name })
      .from(schema.databases)
      .where(inArray(schema.databases.id, dbIds));
    for (const d of found) dbNames.set(d.id, d.name);
  }

  function resolveTarget(r: AuditRow): { title: string | null; href: string | null } {
    if (!r.targetId) return { title: null, href: null };
    if (r.targetType === 'page') {
      const title = pageTitles.get(r.targetId) ?? null;
      return { title, href: title ? `/pages/${r.targetId}` : null };
    }
    if (r.targetType === 'database') {
      return { title: dbNames.get(r.targetId) ?? null, href: null };
    }
    return { title: null, href: null };
  }

  return rows.map((r) => {
    const { title, href } = resolveTarget(r);
    return {
      ...r,
      actorName: r.actorUserId ? (actorNames.get(r.actorUserId) ?? null) : null,
      targetTitle: title,
      targetHref: href,
    };
  });
}
