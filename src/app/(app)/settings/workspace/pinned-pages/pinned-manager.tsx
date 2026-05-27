'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PinRow } from '@/lib/pins/list';

/** Lightweight search hit shape returned by /api/search. */
type Hit = { id: string; title: string };

function SortableRow({
  pin,
  onRemove,
  busy,
}: {
  pin: PinRow;
  onRemove: (pageId: string) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pin.pageId,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center justify-between gap-3 rounded-md border bg-card p-3 ${
        isDragging ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        className="min-h-11 min-w-11 cursor-grab text-muted-foreground"
        aria-label="Drag handle"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <span className="flex-1 truncate">
        {pin.icon ? `${pin.icon} ` : ''}
        {pin.title}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onRemove(pin.pageId)}
        disabled={busy}
      >
        Remove
      </Button>
    </li>
  );
}

/**
 * Admin manager for workspace pins. Renders the existing pin list as a
 * `@dnd-kit/sortable` group with a per-row Remove button, plus an inline
 * search picker (using the existing `/api/search` route) for adding pins.
 *
 * `router.refresh()` after each mutation re-fetches the RSC list so the
 * server-rendered titles stay in sync without a local cache.
 */
export function PinnedManager({ initial }: { initial: PinRow[] }) {
  const router = useRouter();
  const queryId = useId();
  const [pins, setPins] = useState(initial);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Debounced search against /api/search. Aborts in-flight on each keystroke
  // so we never race a stale response onto the list.
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      (async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
            signal: ctrl.signal,
          });
          if (!res.ok) return;
          const body = (await res.json()) as {
            results?: Array<{ id: string; title: string; type?: string }>;
          };
          const pageHits = (body.results ?? [])
            .filter((r) => !r.type || r.type === 'page')
            .slice(0, 10)
            .map((r) => ({ id: r.id, title: r.title }));
          setHits(pageHits);
        } catch {
          // aborted — ignore
        } finally {
          setSearching(false);
        }
      })();
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
      setSearching(false);
    };
  }, [query]);

  async function addPin(hit: Hit) {
    setBusyId(hit.id);
    try {
      const res = await fetch('/api/workspace/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: hit.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Pin failed: ${body.error ?? res.status}`);
        return;
      }
      toast.success(`Pinned: ${hit.title}`);
      setQuery('');
      setHits([]);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onDragEnd(e: DragEndEvent) {
    const overId = e.over?.id;
    if (!overId || e.active.id === overId) return;
    const oldIndex = pins.findIndex((p) => p.pageId === e.active.id);
    const newIndex = pins.findIndex((p) => p.pageId === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const prev = pins;
    const next = arrayMove(pins, oldIndex, newIndex);
    setPins(next);
    const res = await fetch('/api/workspace/pins', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedPageIds: next.map((p) => p.pageId) }),
    });
    if (!res.ok) {
      toast.error('Reorder failed');
      setPins(prev); // rollback
      return;
    }
    router.refresh();
  }

  async function removePin(pageId: string) {
    const prev = pins;
    setBusyId(pageId);
    setPins(pins.filter((p) => p.pageId !== pageId));
    try {
      const res = await fetch(`/api/workspace/pins/${pageId}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Remove failed');
        setPins(prev);
        return;
      }
      toast.success('Pin removed');
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-2 rounded-md border p-4">
        <Label htmlFor={queryId}>Add a pin</Label>
        <Input
          id={queryId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages…"
        />
        {query.trim().length >= 2 && (
          <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto" aria-live="polite">
            {searching && hits.length === 0 && (
              <li className="px-2 py-1 text-xs text-muted-foreground">Searching…</li>
            )}
            {!searching && hits.length === 0 && (
              <li className="px-2 py-1 text-xs text-muted-foreground">No results</li>
            )}
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => addPin(h)}
                  disabled={busyId === h.id || pins.some((p) => p.pageId === h.id)}
                  className="w-full rounded-md px-2 py-1 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  {h.title}
                  {pins.some((p) => p.pageId === h.id) && (
                    <span className="ml-2 text-xs text-muted-foreground">(already pinned)</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pins.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pinned pages yet.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pins.map((p) => p.pageId)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {pins.map((p) => (
                <SortableRow
                  key={p.pageId}
                  pin={p}
                  onRemove={removePin}
                  busy={busyId === p.pageId}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
