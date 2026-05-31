'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Star, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { PrefEntry } from '@/lib/prefs/user-page-prefs';

/**
 * Favorites section with @dnd-kit drag-to-reorder + keyboard reorder
 * (ArrowUp/ArrowDown on the row moves it; Enter on the <Link> opens the page
 * via browser default) + a per-row "Remove from favorites" icon. Mutations
 * POST to `/api/favorites/reorder` (canonical v0.8 endpoint) and
 * `/api/prefs/favorites` (favorite-toggle reused for the remove action).
 */
export function SidebarFavorites({ favorites }: { favorites: PrefEntry[] }) {
  const router = useRouter();
  const [items, setItems] = useState<PrefEntry[]>(favorites);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const postOrder = useCallback(async (orderedFavoriteIds: string[]) => {
    await fetch('/api/favorites/reorder', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedFavoriteIds }),
    });
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      setItems((prev) => {
        const from = prev.findIndex((f) => f.id === active.id);
        const to = prev.findIndex((f) => f.id === over.id);
        if (from === -1 || to === -1) return prev;
        const next = arrayMove(prev, from, to);
        void postOrder(next.map((f) => f.id));
        return next;
      });
    },
    [postOrder],
  );

  const onKeyReorder = useCallback(
    (id: string, direction: 'up' | 'down') => {
      setItems((prev) => {
        const idx = prev.findIndex((f) => f.id === id);
        if (idx === -1) return prev;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= prev.length) return prev;
        const next = arrayMove(prev, idx, targetIdx);
        void postOrder(next.map((f) => f.id));
        return next;
      });
    },
    [postOrder],
  );

  const onRemove = useCallback(
    async (id: string) => {
      const fav = items.find((f) => f.id === id);
      if (!fav) return;
      setItems((prev) => prev.filter((f) => f.id !== id));
      await fetch('/api/prefs/favorites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: fav.pageId }),
      });
      router.refresh();
    },
    [items, router],
  );

  if (items.length === 0) return null;

  return (
    <section aria-label="Favorite pages" className="mb-3">
      <div className="mb-1 flex items-center gap-2 px-2">
        <Star aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Favorites</p>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {items.map((f) => (
              <SortableRow key={f.id} fav={f} onRemove={onRemove} onKeyReorder={onKeyReorder} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function SortableRow({
  fav,
  onRemove,
  onKeyReorder,
}: {
  fav: PrefEntry;
  onRemove: (id: string) => void;
  onKeyReorder: (id: string, direction: 'up' | 'down') => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: fav.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onKeyReorder(fav.id, 'up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onKeyReorder(fav.id, 'down');
    }
    // Enter naturally activates the <Link> below (browser default).
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label={`Drag handle for ${fav.title}`}
        className="cursor-grab text-muted-foreground opacity-0 focus:opacity-100 group-hover:opacity-100"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" className="h-4 w-4" />
      </button>
      <Link
        href={`/pages/${fav.pageId}` as Route}
        className="flex flex-1 items-center gap-2 truncate rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="w-4 shrink-0 text-center">
          {fav.icon ?? ''}
        </span>
        <span className="truncate">{fav.title}</span>
      </Link>
      <button
        type="button"
        aria-label={`Remove ${fav.title} from favorites`}
        onClick={() => onRemove(fav.id)}
        className="rounded p-1 text-muted-foreground opacity-0 hover:bg-background focus:opacity-100 group-hover:opacity-100"
      >
        <X aria-hidden="true" className="h-3 w-3" />
      </button>
    </li>
  );
}
