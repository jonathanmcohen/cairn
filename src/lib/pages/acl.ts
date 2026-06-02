import { and, eq, isNull, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import {
  getAuthContext,
  HttpError,
  requireWorkspace,
  type WorkspaceContext,
} from '@/lib/auth/require-role';

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

type AclRow = { permission: 'view' | 'comment' | 'edit' | 'owner' | null; depth: number };
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
  if (
    hit?.permission === 'view' ||
    hit?.permission === 'comment' ||
    hit?.permission === 'edit' ||
    hit?.permission === 'owner'
  ) {
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

export type PageAclAccess = {
  page: schema.Page;
  ctx: WorkspaceContext;
  effectivePermission: EffectivePermission;
};

/**
 * v0.7 sibling of v0.6 requirePageAccess. Validates the page exists in the
 * active workspace, resolves the user's effective permission via the ACL
 * resolver, and gates on minPermission.
 *
 * - 404 for non-UUID pageId (no DB cast error)
 * - 404 for cross-workspace pageId (no existence leak)
 * - 403 when effectivePermission < minPermission
 * - returns {page, ctx, effectivePermission} otherwise
 *
 * Does NOT replace requirePageAccess — v0.6 routes keep their role-based gate.
 * New v0.7 routes opt into ACL-aware access by calling this instead.
 */
export async function requirePageAcl(
  pageId: string,
  minPermission: EffectivePermission,
): Promise<PageAclAccess> {
  const ctx = requireWorkspace(await getAuthContext());
  if (!UUID_RE.test(pageId)) {
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

  const permission = await resolveEffectivePermission(db, {
    userId: ctx.userId,
    pageId,
  });
  if (!permission) {
    throw new HttpError(403, 'No access to this page');
  }
  if (!permissionAtLeast(permission, minPermission)) {
    throw new HttpError(403, `Requires ${minPermission} permission`);
  }

  return { page, ctx, effectivePermission: permission };
}

export type SetPageAclInput = {
  workspaceId: string;
  pageId: string;
  userId: string;
  permission: 'view' | 'comment' | 'edit' | 'owner';
  actorUserId: string;
};

/**
 * Upsert a page ACL row + record an audit event in one transaction. The audit
 * action is `page.permission_granted` for new rows, `page.permission_changed`
 * for updates (existing row found before the upsert).
 *
 * The metadata records `{userId, permission}` — both are safe (no secret
 * substrings; userId is opaque, permission is a closed enum).
 */
export async function setPageAcl(
  db: PostgresJsDatabase<typeof schema>,
  input: SetPageAclInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.pageAcls)
      .where(
        and(eq(schema.pageAcls.pageId, input.pageId), eq(schema.pageAcls.userId, input.userId)),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(schema.pageAcls)
        .set({ permission: input.permission, updatedAt: new Date() })
        .where(eq(schema.pageAcls.id, existing.id));
    } else {
      await tx.insert(schema.pageAcls).values({
        pageId: input.pageId,
        userId: input.userId,
        permission: input.permission,
      });
    }

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: existing ? 'page.permission_changed' : 'page.permission_granted',
      targetType: 'page_acl',
      targetId: input.pageId,
      metadata: {
        userId: input.userId,
        permission: input.permission,
        ...(existing ? { previousPermission: existing.permission } : {}),
      },
    });
  });
}

export type RemovePageAclInput = {
  workspaceId: string;
  pageId: string;
  userId: string;
  actorUserId: string;
};

/**
 * Delete a page ACL row + record a `page.permission_revoked` audit event in one tx.
 * Idempotent: returns silently if no ACL exists for the (pageId, userId) pair.
 */
export async function removePageAcl(
  db: PostgresJsDatabase<typeof schema>,
  input: RemovePageAclInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.pageAcls)
      .where(
        and(eq(schema.pageAcls.pageId, input.pageId), eq(schema.pageAcls.userId, input.userId)),
      )
      .returning({ id: schema.pageAcls.id, permission: schema.pageAcls.permission });
    if (deleted.length === 0) return;
    const row = deleted[0];

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'page.permission_revoked',
      targetType: 'page_acl',
      targetId: input.pageId,
      metadata: { userId: input.userId, permission: row?.permission ?? null },
    });
  });
}

export type TransferPageOwnershipInput = {
  workspaceId: string;
  pageId: string;
  fromUserId: string;
  toUserId: string;
  actorUserId: string;
};

/**
 * Transfer page-level ownership: grant the new owner a stored 'owner' ACL row
 * and demote the prior owner to 'edit'. Both writes + the audit row happen in a
 * single transaction. Records `page.ownership_transferred` with metadata
 * `{fromUserId, toUserId}`. Idempotent on the demotion (no-op if the prior
 * owner had no ACL row).
 */
export async function transferPageOwnership(
  db: PostgresJsDatabase<typeof schema>,
  input: TransferPageOwnershipInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Grant the new owner.
    await tx
      .insert(schema.pageAcls)
      .values({ pageId: input.pageId, userId: input.toUserId, permission: 'owner' })
      .onConflictDoUpdate({
        target: [schema.pageAcls.pageId, schema.pageAcls.userId],
        set: { permission: 'owner', updatedAt: new Date() },
      });
    // Demote the prior owner to edit (idempotent; no-op if they had no row).
    await tx
      .update(schema.pageAcls)
      .set({ permission: 'edit', updatedAt: new Date() })
      .where(
        and(eq(schema.pageAcls.pageId, input.pageId), eq(schema.pageAcls.userId, input.fromUserId)),
      );
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'page.ownership_transferred',
      targetType: 'page_acl',
      targetId: input.pageId,
      metadata: { fromUserId: input.fromUserId, toUserId: input.toUserId },
    });
  });
}
