import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { requireRole } from '@/lib/auth/require-role';
import { listWorkspaceMembers } from '@/lib/workspaces/admin-members';
import { DangerZone } from './danger-zone';

export default async function DangerPage() {
  // Admin gate first (matches the rest of /settings/admin); we then narrow
  // to owner-only and render a friendly message for non-owners so the link in
  // the nav doesn't dead-end at a redirect.
  const ctx = await requireRole('admin');
  if (ctx.role !== 'owner') {
    return (
      <section>
        <h1 className="mb-4 text-xl font-semibold">Danger zone</h1>
        <p className="text-sm text-muted-foreground">
          Only the workspace owner can transfer ownership or delete this workspace.
        </p>
      </section>
    );
  }
  const db = getDb();
  const [row] = await db
    .select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ctx.workspaceId));
  const members = await listWorkspaceMembers(db, ctx.workspaceId);
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">Danger zone</h1>
      <DangerZone
        workspaceId={ctx.workspaceId}
        workspaceName={row?.name ?? ''}
        actorUserId={ctx.userId}
        members={members.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
        }))}
      />
    </section>
  );
}
