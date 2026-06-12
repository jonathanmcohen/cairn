import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { signFileUrl } from '@/lib/files/signing';
import { parseIcon } from '@/lib/pages/icon-format';

/** Same TTL as the workspace brand logo (src/lib/workspaces/brand.ts). */
const WORKSPACE_ICON_TTL_SECONDS = 60 * 60;

export type UserWorkspace = {
  id: string;
  name: string;
  role: schema.MemberRole;
  // Prefix-encoded icon ("emoji::🪨" / "file::<uuid>") or null (#142). Threaded
  // through to the WorkspaceSwitcher badge.
  icon: string | null;
  /**
   * HMAC-signed `/api/files/<uuid>?sig=&exp=` URL (1 h TTL) — non-null ONLY
   * when `icon` is a `file::<uuid>`. Minted server-side (needs AUTH_SECRET) so
   * the client switcher chip can render the real image, never a raw path.
   */
  iconUrl: string | null;
};

/**
 * Resolve a stored workspace icon to a signed file URL, or null for emoji /
 * unset / malformed icons. Pure (apart from the clock) — unit-testable without
 * a DB. URL shape matches `getWorkspaceBrand`'s logoUrl minting exactly.
 */
export function resolveWorkspaceIconUrl(icon: string | null, secret: string): string | null {
  const parsed = parseIcon(icon);
  if (parsed?.kind !== 'file') return null;
  const expiresAt = Math.floor(Date.now() / 1000) + WORKSPACE_ICON_TTL_SECONDS;
  const sig = signFileUrl({ fileId: parsed.value, expiresAt, secret });
  return `/api/files/${parsed.value}?sig=${sig}&exp=${expiresAt}`;
}

/**
 * List the workspaces a user belongs to (oldest membership first), with their
 * role in each. `opts.secret` (AUTH_SECRET) signs `file::` icon URLs — callers
 * are server components / RSCs only; never expose the secret to the client.
 */
export async function listUserWorkspaces(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  opts: { secret: string },
): Promise<UserWorkspace[]> {
  const rows = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      role: schema.workspaceMembers.role,
      icon: schema.workspaces.icon,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaceMembers.joinedAt));
  return rows.map((row) => ({ ...row, iconUrl: resolveWorkspaceIconUrl(row.icon, opts.secret) }));
}
