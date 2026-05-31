import type { MemberRole } from '@/lib/auth/require-role';

/** Cross-workspace federated search is admin/owner-only, mirroring the
 * /api/search route which only honors include_all_workspaces for those roles. */
export function canFederate(role: MemberRole | null): boolean {
  return role === 'admin' || role === 'owner';
}
