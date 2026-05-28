import { eq, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import type { MemberRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { type SearchFilters, type SearchResult, searchPages } from '@/lib/pages/search';
import { fanOutToPeers } from './peer-fanout';

/**
 * v0.9.0 G5 P30 — federated search orchestrator.
 *
 * Three layered scopes:
 *   1. Membership (always on) — UNION across workspaces the user belongs to.
 *   2. Admin cross-workspace (opt-in) — when `includeAllWorkspaces=true` AND
 *      the caller is `admin`/`owner` on the *current* workspace, ALSO search
 *      workspaces they're not a member of. Emits `search.cross_workspace_admin`
 *      audit on every call (even with zero hits — the privacy concern is the
 *      query itself).
 *   3. Cross-instance (peer fan-out) — populated by `peer-fanout.ts` in Task 4.
 *
 * Encrypted pages (`pages.encrypted = true`) never leave the federation
 * boundary, regardless of scope. The underlying `searchPages` FTS query
 * already filters `encrypted = false`, but the federation layer guards
 * defense-in-depth via a runtime check on the returned rows.
 */

export type FederatedInput = {
  userId: string;
  workspaceId: string;
  role: MemberRole;
  query: string;
  filters: SearchFilters;
  includeAllWorkspaces: boolean;
};

export type FederatedLocalHit = SearchResult & { workspaceId: string };
export type FederatedPeerHit = SearchResult & { peerName: string; workspaceId: string };

export type FederatedResult = {
  local: FederatedLocalHit[];
  /** Reserved — populated by peer-fanout (Task 4). */
  peer: FederatedPeerHit[];
};

async function memberWorkspaceIds(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId));
  return rows.map((r) => r.id);
}

async function nonMemberWorkspaceIds(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
): Promise<string[]> {
  const memberIds = await memberWorkspaceIds(db, userId);
  if (memberIds.length === 0) {
    const all = await db.select({ id: schema.workspaces.id }).from(schema.workspaces);
    return all.map((r) => r.id);
  }
  const rows = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(notInArray(schema.workspaces.id, memberIds));
  return rows.map((r) => r.id);
}

async function searchOneWorkspace(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  query: string,
  filters: SearchFilters,
): Promise<FederatedLocalHit[]> {
  const results = await searchPages(db, {
    workspaceId,
    query,
    limit: 20,
    filters,
    mode: 'fts',
  });
  // Defense-in-depth: searchPages already filters encrypted=false in SQL,
  // but a federated boundary should re-check rather than trust the caller.
  // Runtime guard so pre-P5 builds (no `encrypted` column) still compile.
  const filtered = results.filter(
    (r) => !('encrypted' in r) || (r as { encrypted?: boolean }).encrypted !== true,
  );
  return filtered.map((r) => ({ ...r, workspaceId }));
}

export async function federatedSearch(
  db: PostgresJsDatabase<typeof schema>,
  input: FederatedInput,
): Promise<FederatedResult> {
  const memberIds = await memberWorkspaceIds(db, input.userId);

  // Scope 1: every workspace the user is a member of.
  const memberHits = (
    await Promise.all(
      memberIds.map((wid) => searchOneWorkspace(db, wid, input.query, input.filters)),
    )
  ).flat();

  // Scope 2: admin cross-workspace escape-hatch.
  let adminHits: FederatedLocalHit[] = [];
  const isAdmin = input.role === 'admin' || input.role === 'owner';
  if (input.includeAllWorkspaces && isAdmin) {
    const others = await nonMemberWorkspaceIds(db, input.userId);
    adminHits = (
      await Promise.all(
        others.map((wid) => searchOneWorkspace(db, wid, input.query, input.filters)),
      )
    ).flat();
    // Audit fires on EVERY admin cross-workspace search call, even zero
    // hits. The privacy concern is the QUERY, not the result set.
    await recordAudit(db, {
      action: 'search.cross_workspace_admin',
      actorUserId: input.userId,
      workspaceId: input.workspaceId,
      targetType: 'workspace',
      targetId: input.workspaceId,
      metadata: { query: input.query, scope: 'admin_cross_workspace' },
    });
  }

  // Scope 3: cross-instance fan-out. Skipped when the shared-secret env is
  // empty (default for fresh installs) — the federation surface is opt-in.
  const sharedSecret = env().CAIRN_FEDERATION_SHARED_SECRET;
  const peer = sharedSecret
    ? await fanOutToPeers(db, {
        workspaceId: input.workspaceId,
        query: input.query,
        sharedSecret,
      })
    : [];

  return {
    local: [...memberHits, ...adminHits],
    peer,
  };
}
