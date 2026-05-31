import type { MemberRole } from '@/db/schema';

/**
 * Pure, client-safe role helpers. Extracted from `require-role.ts` (which is
 * server-only — it imports `next/headers`, the db client, the session store,
 * and the metrics registry, the last of which drags `prom-client`'s
 * `require('cluster')` into any client bundle that touches it). Client
 * components that only need the role *ranking* (e.g. comment panels deciding
 * whether the current member can resolve/delete) import from here instead.
 */
export type { MemberRole };

const RANK: Record<MemberRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export function hasMinRole(actual: MemberRole, required: MemberRole): boolean {
  return RANK[actual] >= RANK[required];
}
