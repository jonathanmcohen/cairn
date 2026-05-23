import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

/**
 * Effective permission tier returned by the resolver. Ordered for the
 * min-permission gate in requirePageAcl: 'view' < 'comment' < 'edit' < 'owner'.
 * 'owner' is the workspace-owner bypass; routes that gate on 'edit' accept
 * 'owner' transparently via the comparator below.
 */
export type EffectivePermission = 'view' | 'comment' | 'edit' | 'owner';

const ORDER: Record<EffectivePermission, number> = {
  view: 1,
  comment: 2,
  edit: 3,
  owner: 4,
};

export function permissionAtLeast(
  actual: EffectivePermission,
  required: EffectivePermission,
): boolean {
  return ORDER[actual] >= ORDER[required];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AclRow = { permission: 'view' | 'comment' | 'edit' | null; depth: number };
type RoleRow = { role: schema.MemberRole };

/**
 * Walk pages.parent_id upward from pageId. For each level, LEFT JOIN
 * page_acls(user_id = $userId). Return the deepest (closest-to-pageId)
 * non-null permission. If no ACL exists anywhere in the chain, fall back to
 * the user's workspace role:
 *   - owner   -> 'owner'  (workspace-wide bypass)
 *   - admin   -> 'edit'
 *   - editor  -> 'edit'
 *   - viewer  -> 'view'
 *   - no membership -> null
 *
 * The workspace `owner` role bypasses any ACL chain entirely — even an
 * explicit 'view' ACL pinned on the page itself yields 'owner'.
 *
 * Returns null for an unknown / malformed pageId.
 */
export async function resolveEffectivePermission(
  db: PostgresJsDatabase<typeof schema>,
  args: { userId: string; pageId: string },
): Promise<EffectivePermission | null> {
  if (!UUID_RE.test(args.pageId)) return null;
  if (!UUID_RE.test(args.userId)) return null;

  // Look up the workspace role first so an `owner` short-circuits before we
  // ever read page_acls. A page in a workspace the user doesn't belong to
  // returns no row, which we treat as "no membership" below.
  const roleRows = (await db.execute(rawSql`
    SELECT wm.role AS role
      FROM pages p
      INNER JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
     WHERE p.id = ${args.pageId}::uuid AND wm.user_id = ${args.userId}::uuid
     LIMIT 1
  `)) as unknown as RoleRow[];

  const roleRow = roleRows[0];
  if (roleRow?.role === 'owner') return 'owner';

  // Recursive CTE: start at the target page, walk up via parent_id, LEFT JOIN
  // page_acls. depth=0 is the target page; deeper depth = farther ancestor.
  // ORDER BY depth ASC then LIMIT 1 returns the nearest non-null ACL.
  const aclRows = (await db.execute(rawSql`
    WITH RECURSIVE chain(id, parent_id, depth) AS (
      SELECT id, parent_id, 0 FROM pages WHERE id = ${args.pageId}::uuid
      UNION ALL
      SELECT p.id, p.parent_id, c.depth + 1
        FROM pages p
        INNER JOIN chain c ON p.id = c.parent_id
    )
    SELECT acl.permission AS permission, c.depth AS depth
      FROM chain c
      LEFT JOIN page_acls acl
        ON acl.page_id = c.id AND acl.user_id = ${args.userId}::uuid
     WHERE acl.permission IS NOT NULL
     ORDER BY c.depth ASC
     LIMIT 1
  `)) as unknown as AclRow[];

  const hit = aclRows[0];
  if (hit?.permission === 'view' || hit?.permission === 'comment' || hit?.permission === 'edit') {
    return hit.permission;
  }

  // No ACL anywhere up the chain — fall through to the workspace role.
  if (!roleRow) return null;
  switch (roleRow.role) {
    case 'admin':
    case 'editor':
      return 'edit';
    case 'viewer':
      return 'view';
    default:
      return null;
  }
}
