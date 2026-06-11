import { redirect } from 'next/navigation';
import { type ArchivedItem, ArchivedList } from '@/components/archived-list';
import { getDb } from '@/db/client';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';
import { listArchivedPages } from '@/lib/pages/archived';

/**
 * v0.10.0 D5 — /archived browse view (mirrors /trash). Archived pages are
 * hidden from the sidebar tree AND search, so this is the one place to find
 * and recover them. Viewers get a read-only list; editors+ can un-archive
 * (same role bar as the trash restore route).
 */
export default async function ArchivedPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect('/login');
  const entries = await listArchivedPages(getDb(), ctx.workspaceId);
  const initialItems: ArchivedItem[] = entries.map((e) => ({
    id: e.id,
    title: e.title,
    icon: e.icon,
    archivedAt: e.archivedAt.toISOString(),
    parents: e.parents.map((p) => p.title),
  }));
  const canUnarchive = ctx.role != null && hasMinRole(ctx.role, 'editor');
  return (
    <div className="mx-auto max-w-2xl">
      <ArchivedList initialItems={initialItems} canUnarchive={canUnarchive} />
    </div>
  );
}
