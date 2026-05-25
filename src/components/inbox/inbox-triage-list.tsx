'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useState } from 'react';
import { EmptyInbox } from '@/components/empty-state/variants';
import { Button } from '@/components/ui/button';
import { copy } from '@/lib/copy/messages';

export type InboxItem = {
  id: string;
  title: string;
  capturedAt: string;
  sourceUrl: string | null;
};

export function InboxTriageList({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return <EmptyInbox />;
  }

  async function onDone(id: string): Promise<void> {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${id}/done`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mark-done failed');
    } finally {
      setBusy(null);
    }
  }

  function onDragStart(e: React.DragEvent, id: string): void {
    // Sidebar drop targets pick this up via `text/cairn-page-id`; the existing
    // page-move handler already understands the format.
    e.dataTransfer.setData('text/cairn-page-id', id);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ul className="space-y-2">
        {items.map((it) => (
          <li
            key={it.id}
            draggable
            onDragStart={(e) => onDragStart(e, it.id)}
            className="flex items-start gap-3 rounded border bg-card p-3"
          >
            <div className="flex-1 cursor-grab active:cursor-grabbing">
              <a href={`/pages/${it.id}` as Route} className="font-medium hover:underline">
                {it.title}
              </a>
              <div className="mt-1 text-xs text-muted-foreground">
                Captured {new Date(it.capturedAt).toLocaleString()}
                {it.sourceUrl ? (
                  <>
                    {' · '}
                    <span className="underline">{it.sourceUrl}</span>
                  </>
                ) : null}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy === it.id}
              onClick={() => void onDone(it.id)}
            >
              {busy === it.id ? copy('inboxTriage.markingDone') : copy('inboxTriage.markDone')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
