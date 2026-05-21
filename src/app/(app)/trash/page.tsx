import { redirect } from 'next/navigation';
import { type TrashItem, TrashList } from '@/components/trash-list';
import { getDb } from '@/db/client';
import { getAuthContext } from '@/lib/auth/require-role';
import { listTrash } from '@/lib/pages/trash';

export default async function TrashPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect('/login');
  const entries = await listTrash(getDb(), ctx.workspaceId);
  const initialItems: TrashItem[] = entries.map((e) => ({
    id: e.id,
    title: e.title,
    icon: e.icon,
    deletedAt: e.deletedAt.toISOString(),
  }));
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-3xl font-semibold">Trash</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Items here are recoverable for 30 days, then permanently removed.
      </p>
      <TrashList initialItems={initialItems} />
    </div>
  );
}
