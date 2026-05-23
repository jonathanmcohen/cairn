import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { listPendingInvites } from '@/lib/workspaces/invites';
import { InvitesManager } from '../invites-manager';

export default async function AdminInvitesPage() {
  const ctx = await requireRole('admin');
  const invites = await listPendingInvites(getDb(), ctx.workspaceId);
  // Drop the raw `Date` objects → ISO strings for the client component boundary.
  const serialized = invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    token: i.token,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  }));
  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">Invites</h1>
      <InvitesManager workspaceId={ctx.workspaceId} invites={serialized} />
    </section>
  );
}
