'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type TrashItem = {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: string;
};

export function TrashList({ initialItems }: { initialItems: TrashItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    const res = await fetch(`/api/pages/${id}/restore`, { method: 'POST' });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    }
  }

  async function purge(id: string) {
    if (!confirm('Permanently delete? This cannot be undone.')) return;
    setBusy(id);
    const res = await fetch(`/api/trash/${id}`, { method: 'DELETE' });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    }
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground">Trash is empty.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between rounded border px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="text-lg">{item.icon ?? '📄'}</span>
            <div>
              <div className="font-medium">{item.title}</div>
              <div className="text-xs text-muted-foreground">
                Deleted {new Date(item.deletedAt).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy === item.id}
              onClick={() => void restore(item.id)}
            >
              Restore
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy === item.id}
              onClick={() => void purge(item.id)}
              className="text-destructive hover:text-destructive"
            >
              Delete forever
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
