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
import { GripVertical } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { InlineIcon } from '@/components/page-icon-inline';

/**
 * v0.9.0 G2 P12 — Workspace-pinned section row shape (mirrors `PinRow` from
 * `@/lib/pins/list`, but redeclared client-side so this leaf component
 * imports nothing server-only).
 */
type PinRow = { pageId: string; title: string; icon: string | null; position: number };

const ROW_LINK_CLASS =
  'flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function PinLinkInner({ pin }: { pin: PinRow }) {
  return (
    <>
      {pin.icon ? (
        <span aria-hidden="true" className="text-base leading-none">
          <InlineIcon value={pin.icon} fallback={null} />
        </span>
      ) : null}
      <span className="truncate">{pin.title}</span>
    </>
  );
}

/** v0.10.3 Q-18 — sortable row (admin only): drag handle + the navigable link. */
function SortablePin({ pin }: { pin: PinRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pin.pageId,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center ${isDragging ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab px-1 text-muted-foreground/60 hover:text-foreground"
        aria-label={`Reorder ${pin.title}`}
        data-testid={`pin-drag-${pin.pageId}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <Link href={`/pages/${pin.pageId}` as Route} className={ROW_LINK_CLASS}>
        <PinLinkInner pin={pin} />
      </Link>
    </li>
  );
}

/**
 * Workspace-wide "Pinned" section at the very top of the sidebar.
 *
 * Renders above the per-user Favorites group (v0.8 P17) and the per-space
 * groups (v0.9 P11). Fetches once on mount via `GET /api/workspace/pins` —
 * the route is gated to workspace members, so an unauthenticated user gets
 * 401 + an empty render.
 *
 * v0.10.3 Q-18 — admins (`canManage`) can drag-reorder the pins inline; the
 * new order is persisted with `PUT /api/workspace/pins` (admin-gated) and
 * rolled back on failure. Non-admins see plain, non-draggable links.
 *
 * Returns `null` when the workspace has no pins so the section collapses to
 * zero pixels rather than rendering an empty header.
 */
export function PinnedSection({ canManage = false }: { canManage?: boolean }) {
  const [pins, setPins] = useState<PinRow[] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workspace/pins');
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { pins: PinRow[] };
        if (!cancelled) setPins(body.pins);
      } catch {
        // ignore — sidebar is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onDragEnd(e: DragEndEvent) {
    const overId = e.over?.id;
    if (!overId || e.active.id === overId || !pins) return;
    const oldIndex = pins.findIndex((p) => p.pageId === e.active.id);
    const newIndex = pins.findIndex((p) => p.pageId === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const prev = pins;
    const next = arrayMove(pins, oldIndex, newIndex);
    setPins(next); // optimistic
    const res = await fetch('/api/workspace/pins', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedPageIds: next.map((p) => p.pageId) }),
    });
    if (!res.ok) setPins(prev); // rollback
  }

  if (!pins || pins.length === 0) return null;

  return (
    <section data-testid="pinned-section" className="mb-3 px-2">
      {/* v0.10.2 S4 — font-semibold dropped: Pinned was the lone semibold
          outlier among the five section headers; all now share 10px/60%
          regular weight. */}
      <div className="mb-1 px-2 text-[length:var(--cairn-sidebar-heading)] uppercase tracking-wide text-foreground/60">
        Pinned
      </div>
      {canManage ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pins.map((p) => p.pageId)} strategy={verticalListSortingStrategy}>
            <ul>
              {pins.map((p) => (
                <SortablePin key={p.pageId} pin={p} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul>
          {pins.map((p) => (
            <li key={p.pageId}>
              <Link href={`/pages/${p.pageId}` as Route} className={ROW_LINK_CLASS}>
                <PinLinkInner pin={p} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
