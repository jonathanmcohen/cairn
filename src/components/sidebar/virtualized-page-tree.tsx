'use client';

import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  MeasuringStrategy,
  PointerSensor,
  type pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyPageTree } from '@/components/empty-state/variants';
import { InlineIcon } from '@/components/page-icon-inline';
import { useT } from '@/lib/i18n/provider';
import type { FlatPageNode } from '@/lib/pages/tree';
import { cn } from '@/lib/utils';
import {
  DEPTH_INDENT_PX,
  getSidebarDensity,
  ROW_HEIGHT_BY_DENSITY,
  ROW_HEIGHT_PX,
  SIDEBAR_DENSITY_EVENT,
  type SidebarDensity,
} from './density-tokens';
import { PageRowActionsMenu } from './page-row-actions-menu';
import { PageRowContextMenu } from './page-row-context-menu';
import { usePageRowActions } from './use-page-row-actions';

/**
 * Render a page row's stored icon string via the shared client-safe
 * {@link InlineIcon} so the `emoji::`/`file::` shortcode prefix never leaks into
 * the DOM. Null → a neutral document glyph; file icons → the InlineIcon default
 * neutral image glyph (signed image URLs resolve server-side elsewhere).
 */
function renderNodeIcon(stored: string | null): React.ReactNode {
  return (
    <InlineIcon
      value={stored}
      fallback={<FileText aria-hidden="true" className="h-4 w-4 text-muted-foreground" />}
    />
  );
}

// Density contract lives in density-tokens.ts (dependency-free) so the H3
// runtime-px e2e can import it; re-exported here for existing consumers.
export { ROW_HEIGHT_PX };

const OVERSCAN = 8; // Extra rows above/below the viewport for smooth scroll.

/** v0.9.0 G2 P11 — minimal space descriptor consumed by the sidebar. */
export type SidebarSpace = {
  id: string;
  name: string;
  icon: string | null;
  position: number;
};

/** Internal row union: either a space-header divider or a page link. */
type Row =
  | {
      kind: 'space-header';
      key: string;
      spaceId: string | null;
      name: string;
      icon: string | null;
    }
  | { kind: 'page'; key: string; page: FlatPageNode };

const UNFILED_SPACE_ID = '__unfiled__';

/**
 * v0.10.2 S8 — DnD drop intent for a hovered page row. The pointer's vertical
 * position inside the row picks the semantics:
 *   - top 25%    → 'before' (insert above the row, same parent)
 *   - bottom 25% → 'after'  (insert below the row, same parent)
 *   - middle 50% → 'into'   (reparent onto the row, appended last)
 */
type DropZone = 'before' | 'after' | 'into';
const EDGE_ZONE_RATIO = 0.25;

/**
 * Build the flat row sequence the virtualizer iterates over. Spaces appear in
 * (position asc, name asc) order; empty spaces are omitted. Pages with NULL
 * `spaceId` are bucketed into a synthetic "Unfiled" group at the bottom.
 *
 * When `spaces` is empty/undefined we fall back to the legacy flat list so
 * the sidebar keeps working pre-spaces-adoption.
 */
function buildRows(pages: FlatPageNode[], spaces: SidebarSpace[] | undefined): Row[] {
  if (!spaces || spaces.length === 0) {
    return pages.map((p) => ({ kind: 'page' as const, key: p.id, page: p }));
  }
  const sortedSpaces = [...spaces].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  const rows: Row[] = [];
  for (const sp of sortedSpaces) {
    const inSpace = pages.filter((p) => p.spaceId === sp.id);
    if (inSpace.length === 0) continue;
    rows.push({
      kind: 'space-header',
      key: `space-${sp.id}`,
      spaceId: sp.id,
      name: sp.name,
      icon: sp.icon,
    });
    for (const p of inSpace) rows.push({ kind: 'page' as const, key: p.id, page: p });
  }
  const unfiled = pages.filter((p) => p.spaceId === null || p.spaceId === undefined);
  if (unfiled.length > 0) {
    rows.push({
      kind: 'space-header',
      key: 'space-unfiled',
      spaceId: null,
      name: 'Unfiled',
      icon: null,
    });
    for (const p of unfiled) rows.push({ kind: 'page' as const, key: p.id, page: p });
  }
  return rows;
}

/**
 * Windowed render of the page-tree sidebar. The server pre-flattens the tree
 * via `flattenedPageTree(workspaceId)` so this component never recurses; the
 * virtualizer keys rendering by index. v0.9.0 G2 P11 layered space grouping on
 * top — pass `spaces` and rows are grouped under collapsible space headers.
 * v0.10.2 S8 layered per-page collapse (chevron + child-count badge) and
 * @dnd-kit drag-to-reorder/reparent on top of the same flat list.
 *
 * The scroll container is THIS component's own <ul> wrapped in a fixed-height
 * <div> (`h-full overflow-y-auto`). The parent sidebar <nav> owns layout
 * (flex-1 minus header/footer); this component fills its parent.
 */
export function VirtualizedPageTree({
  initial,
  spaces,
  collapseAll,
}: {
  initial: FlatPageNode[];
  spaces?: SidebarSpace[];
  /** When true, every space header is force-collapsed (driven by PagesSection's
   *  expand/collapse-all toggle, #213). When false/undefined, per-header local
   *  toggle state applies. v0.10.2 S8: a flip also SEEDS the per-page collapsed
   *  set (true → every page with children collapses; false → all expand), after
   *  which individual chevrons keep working against the seeded set. */
  collapseAll?: boolean;
}) {
  const router = useRouter();
  const parentRef = useRef<HTMLDivElement>(null);
  // Local-only collapse state keyed by spaceId (or `__unfiled__`). Persists
  // for the component lifetime; remembering it across navigations is left to
  // a future plan (would need `user_page_prefs.collapsed_spaces`).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // v0.10.2 S8 — per-page collapse (chevron). Default expanded; no persistence.
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set());
  const togglePage = useCallback((id: string) => {
    setCollapsedPages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Reconcile with the section-level collapse/expand-all toggle: a FLIP of
  // `collapseAll` seeds the collapsed set (every page with children, or none)
  // instead of force-deriving it, so per-chevron toggles still work afterwards.
  // The ref starts false so mounting with collapseAll=true also seeds.
  const prevCollapseAll = useRef(false);
  useEffect(() => {
    const flag = collapseAll ?? false;
    if (prevCollapseAll.current === flag) return;
    prevCollapseAll.current = flag;
    setCollapsedPages(
      flag ? new Set(initial.filter((n) => n.childCount > 0).map((n) => n.id)) : new Set(),
    );
  }, [collapseAll, initial]);

  // Hide every row whose ancestor chain contains a collapsed page. `initial`
  // is in DFS order (parents strictly before descendants), so one forward pass
  // propagates hiddenness down the chain.
  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    if (collapsedPages.size === 0) return hidden;
    for (const n of initial) {
      if (n.parentId && (collapsedPages.has(n.parentId) || hidden.has(n.parentId))) {
        hidden.add(n.id);
      }
    }
    return hidden;
  }, [initial, collapsedPages]);

  const visiblePages = useMemo(
    () => (hiddenIds.size === 0 ? initial : initial.filter((n) => !hiddenIds.has(n.id))),
    [initial, hiddenIds],
  );

  const rows = useMemo(() => {
    const allRows = buildRows(visiblePages, spaces);
    // When collapseAll is on, derive the full set of space keys from the
    // headers so every section folds at once (#213); otherwise use the local
    // per-header toggle state.
    const effective = collapseAll
      ? new Set(
          allRows
            .filter((r) => r.kind === 'space-header')
            .map((r) => (r.kind === 'space-header' ? (r.spaceId ?? UNFILED_SPACE_ID) : '')),
        )
      : collapsed;
    if (effective.size === 0) return allRows;
    // Hide page rows for collapsed sections. Walk linearly: any page row that
    // follows a collapsed header is skipped until the next header.
    const out: Row[] = [];
    let collapseCurrent = false;
    for (const r of allRows) {
      if (r.kind === 'space-header') {
        const key = r.spaceId ?? UNFILED_SPACE_ID;
        collapseCurrent = effective.has(key);
        out.push(r);
      } else if (!collapseCurrent) {
        out.push(r);
      }
    }
    return out;
  }, [visiblePages, spaces, collapsed, collapseAll]);

  // v0.10.2 S2 — per-device density (comfortable 26px / compact 22px rows).
  // SSR and first client render both use 'comfortable' so hydration matches;
  // the mount effect then reads the persisted value (localStorage) and
  // subscribes to live changes from the theme settings form.
  const [density, setDensity] = useState<SidebarDensity>('comfortable');
  useEffect(() => {
    setDensity(getSidebarDensity());
    const onDensityChanged = (e: Event) => {
      const detail = (e as CustomEvent<SidebarDensity>).detail;
      setDensity(detail === 'compact' ? 'compact' : 'comfortable');
    };
    window.addEventListener(SIDEBAR_DENSITY_EVENT, onDensityChanged);
    return () => window.removeEventListener(SIDEBAR_DENSITY_EVENT, onDensityChanged);
  }, []);
  const rowHeight = ROW_HEIGHT_BY_DENSITY[density];

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]?.key ?? index,
    // Seed the viewport so the initial render window isn't empty before the
    // ResizeObserver fires (matters for SSR hydration and jsdom tests where
    // layout never measures). 600px ≈ one sidebar viewport on a laptop.
    initialRect: { width: 240, height: 600 },
  });

  // ---- v0.10.2 S8 DnD wiring -------------------------------------------
  // PointerSensor with a 6px activation distance so a plain click still
  // navigates via the row's <Link>; only a real drag arms the sensor.
  // KeyboardSensor is deliberately omitted — it would fight the row link's
  // Enter/Space activation.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const nodeById = useMemo(() => new Map(initial.map((n) => [n.id, n])), [initial]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTargetState] = useState<{ id: string; zone: DropZone } | null>(null);
  // onDragEnd needs the latest drop target synchronously; mirror it in a ref.
  const dropTargetRef = useRef<typeof dropTarget>(null);
  const setDropTarget = useCallback((next: { id: string; zone: DropZone } | null) => {
    dropTargetRef.current = next;
    setDropTargetState(next);
  }, []);
  // The dragged page + all of its descendants are never valid drop targets
  // (a drop there would cycle). Computed once per drag from the DFS list.
  const blockedRef = useRef<Set<string>>(new Set());

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const id = String(e.active.id);
      const blocked = new Set<string>([id]);
      // DFS order: parents precede descendants, one pass collects the subtree.
      for (const n of initial) {
        if (n.parentId && blocked.has(n.parentId)) blocked.add(n.id);
      }
      blockedRef.current = blocked;
      setActiveId(id);
      setDropTarget(null);
    },
    [initial, setDropTarget],
  );

  // Live-DOM hit testing. dnd-kit caches droppable rects and its auto-scroll
  // shifts the container mid-drag WITHOUT updating them — pointerWithin then
  // resolves `over` (and any rect-based zone math) a row off. Hit-test the
  // droppables' CURRENT client rects instead, and remember the live pointer
  // for the zone calculation in onDragMove.
  const pointerYRef = useRef<number | null>(null);
  const collisionDetection = useCallback((args: Parameters<typeof pointerWithin>[0]) => {
    const p = args.pointerCoordinates;
    pointerYRef.current = p?.y ?? null;
    if (!p) return [];
    for (const container of args.droppableContainers) {
      const el = container.node.current;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) {
        return [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
      }
    }
    return [];
  }, []);

  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const over = e.over;
      if (!over) return setDropTarget(null);
      const overId = String(over.id);
      // Self/descendant targets show NO indicator (space headers never
      // register as droppables, so they are ignored for free).
      if (blockedRef.current.has(overId)) return setDropTarget(null);
      const pointerY = pointerYRef.current;
      if (pointerY === null) return setDropTarget(null);
      // Zone from the over row's LIVE rect (same live-DOM source as the
      // collision pass) — over.rect is dnd-kit's cached copy and goes stale
      // under auto-scroll.
      const overEl = document.querySelector(`[data-virtual-row][data-node-id="${overId}"]`);
      const liveRect = overEl?.getBoundingClientRect();
      const top = liveRect?.top ?? over.rect.top;
      const height = liveRect?.height ?? over.rect.height;
      const ratio = (pointerY - top) / height;
      const zone: DropZone =
        ratio < EDGE_ZONE_RATIO ? 'before' : ratio > 1 - EDGE_ZONE_RATIO ? 'after' : 'into';
      setDropTarget({ id: overId, zone });
    },
    [setDropTarget],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const draggedId = String(e.active.id);
      const drop = dropTargetRef.current;
      setActiveId(null);
      setDropTarget(null);
      if (!drop || drop.id === draggedId) return;
      const target = nodeById.get(drop.id);
      if (!target) return;
      const body =
        drop.zone === 'into'
          ? { newParentId: drop.id }
          : drop.zone === 'before'
            ? { newParentId: target.parentId, beforeId: target.id }
            : { newParentId: target.parentId, afterId: target.id };
      void fetch(`/api/pages/${draggedId}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((res) => {
        // Same refresh path the row mutations use (add-child / Move-To): the
        // tree is server-rendered initial props, so re-run the server
        // component to pick up the new order/parent.
        if (res.ok) router.refresh();
      });
    },
    [nodeById, router, setDropTarget],
  );

  const onDragCancel = useCallback(() => {
    setActiveId(null);
    setDropTarget(null);
  }, [setDropTarget]);

  const activeNode = activeId ? nodeById.get(activeId) : undefined;

  // When density changes, the estimateSize closure above already returns the
  // new height, but TanStack virtual caches measurements — measure() drops
  // the cache so every row re-sizes and re-offsets (no overlap/gap).
  // biome-ignore lint/correctness/useExhaustiveDependencies: rowHeight is deliberately listed — the effect must re-run on density change even though measure() doesn't read it
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  if (initial.length === 0) {
    return (
      <div className="px-2 py-4">
        <EmptyPageTree />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // The virtualizer positions rows via translateY; dnd-kit's DEFAULT
      // droppable measurement is transform-AGNOSTIC, which collapses every
      // row rect to the list top and pointerWithin never matches. Measure
      // with the real (transformed) client rect instead.
      measuring={{
        droppable: {
          // Plain object, NOT the DOMRect itself: dnd-kit spreads the measured
          // rect, and DOMRect's fields are prototype getters that a spread
          // silently drops (top/left arrive as undefined → no collisions).
          measure: (el) => {
            const r = el.getBoundingClientRect();
            return {
              top: r.top,
              left: r.left,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          },
        },
      }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div ref={parentRef} className="h-full overflow-y-auto cairn-thin-scrollbar">
        <ul className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtual) => {
            const row = rows[virtual.index];
            if (!row) return null;
            const baseStyle = {
              position: 'absolute' as const,
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtual.size}px`,
              transform: `translateY(${virtual.start}px)`,
            };
            if (row.kind === 'space-header') {
              const key = row.spaceId ?? UNFILED_SPACE_ID;
              const isCollapsed = collapseAll || collapsed.has(key);
              return (
                <li
                  key={row.key}
                  data-virtual-row=""
                  data-row-kind="space-header"
                  data-space-id={row.spaceId ?? ''}
                  style={baseStyle}
                >
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent"
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? (
                      <ChevronRight aria-hidden="true" className="h-3 w-3" />
                    ) : (
                      <ChevronDown aria-hidden="true" className="h-3 w-3" />
                    )}
                    <span className="w-4 shrink-0 text-center" aria-hidden="true">
                      <InlineIcon
                        value={row.icon}
                        fallback={<Folder className="inline h-3 w-3" />}
                      />
                    </span>
                    <span className="truncate" title={row.name}>
                      {row.name}
                    </span>
                  </button>
                </li>
              );
            }
            const node = row.page;
            return (
              <PageTreeRow
                key={row.key}
                node={node}
                rowKey={row.key}
                style={baseStyle}
                pageCollapsed={collapsedPages.has(node.id)}
                onTogglePage={togglePage}
                dropZone={dropTarget?.id === node.id ? dropTarget.zone : null}
              />
            );
          })}
        </ul>
      </div>
      {/* Lightweight drag preview chip; the source row stays in place dimmed. */}
      <DragOverlay dropAnimation={null}>
        {activeNode ? (
          <div className="pointer-events-none flex w-fit max-w-56 items-center gap-1.5 rounded border bg-popover px-2 py-0.5 text-xs text-popover-foreground shadow-md">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none">
              {renderNodeIcon(activeNode.icon)}
            </span>
            <span className="truncate">{activeNode.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * A single page row. The `<Link>` is a full-bleed `absolute inset-0` overlay so
 * the ENTIRE row navigates to `/pages/[id]` on click and (being a real focusable
 * <a>) on Enter/Space — fixing the v0.9.4 regression where the Link was a
 * `flex-1` strip and the always-mounted 44px action cluster bled over the 32px
 * row, leaving large non-navigating dead zones (#150). The icon+title layer is
 * `pointer-events-none` so clicks fall through to the overlay; the trailing
 * action cluster is a `relative z-10` sibling stacked above the overlay so its
 * `+`/`…` buttons (which `stopPropagation`) keep receiving clicks without ever
 * triggering navigation. The cluster stays in the DOM (revealed via opacity,
 * never `hidden`) so it remains keyboard- and SR-reachable; v0.10.2 S8 keeps it
 * persistently dimmed (opacity-30) instead of fully hidden so the affordance is
 * discoverable, snapping to full opacity on hover/focus. The action hook is
 * called exactly once here so inline-rename state lives in the row (the title
 * `<span>` swaps for an `<input>` while renaming).
 *
 * v0.10.2 S8 additions, all height-neutral (the H3 pixel contract pins the row
 * at ROW_HEIGHT_PX):
 *   - a leading chevron (childCount > 0) toggling client-side collapse, or an
 *     equal-width spacer on leaf rows so titles at the same depth stay aligned;
 *   - a trailing child-count badge (childCount > 0);
 *   - @dnd-kit drag source + drop target. Drop indicators are absolutely
 *     positioned overlays: a 2px insertion line at the top/bottom edge
 *     ('before'/'after') or a bg-accent + inset-start bar reparent cue ('into').
 */
function PageTreeRow({
  node,
  rowKey,
  style,
  pageCollapsed,
  onTogglePage,
  dropZone,
}: {
  node: FlatPageNode;
  rowKey: string;
  style: React.CSSProperties;
  pageCollapsed: boolean;
  onTogglePage: (id: string) => void;
  dropZone: DropZone | null;
}) {
  const t = useT();
  const api = usePageRowActions(node);
  const {
    setNodeRef: setDragRef,
    listeners,
    isDragging,
  } = useDraggable({ id: node.id, data: { node } });
  const { setNodeRef: setDropRef } = useDroppable({ id: node.id, data: { node } });
  const setRowRef = (el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };
  const hasChildren = node.childCount > 0;
  return (
    <li
      key={rowKey}
      ref={setRowRef}
      data-virtual-row=""
      data-row-kind="page"
      data-node-id={node.id}
      data-depth={node.depth}
      style={style}
      // Suspend drag listeners while renaming so dragging inside the rename
      // input selects text instead of starting a row drag.
      {...(api.renaming ? {} : (listeners ?? {}))}
    >
      <PageRowContextMenu node={node} api={api}>
        <div
          className={cn(
            'group relative flex items-center gap-1.5 rounded pr-1 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] hover:bg-accent focus-within:bg-accent',
            isDragging && 'opacity-50',
            dropZone === 'into' && 'bg-accent',
          )}
          style={{ paddingLeft: `${node.depth * DEPTH_INDENT_PX + 8}px` }}
        >
          {/* Drop indicators: absolutely positioned overlays, never affecting
              the row's height (H3 pixel contract). */}
          {dropZone === 'before' || dropZone === 'after' ? (
            <span
              data-testid="tree-drop-line"
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded bg-primary',
                dropZone === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2',
              )}
            />
          ) : null}
          {dropZone === 'into' ? (
            <span
              data-testid="tree-drop-parent"
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-primary"
              style={{ insetInlineStart: `${(node.depth + 1) * DEPTH_INDENT_PX}px` }}
            />
          ) : null}
          {/* Leading chevron (children) or equal-width spacer (leaf) so titles
              at the same depth align. The button sits above the nav overlay
              (z-10) and stops propagation so toggling never navigates. */}
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={!pageCollapsed}
              aria-label={t('sidebar.pages.toggleChildren', { title: node.title })}
              className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTogglePage(node.id);
              }}
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  'h-3 w-3 transition-transform motion-reduce:transition-none',
                  !pageCollapsed && 'rotate-90',
                )}
              />
            </button>
          ) : (
            <span data-chevron-spacer="" aria-hidden="true" className="h-4 w-4 shrink-0" />
          )}
          {api.renaming ? (
            <>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none">
                {renderNodeIcon(node.icon)}
              </span>
              <input
                type="text"
                // biome-ignore lint/a11y/noAutofocus: inline rename — focusing the input immediately is the expected UX when the user invokes "Rename"
                autoFocus
                aria-label={t('pageRow.rename')}
                defaultValue={node.title}
                className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void api.submitRename((e.target as HTMLInputElement).value);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    api.cancelRename();
                  }
                }}
                onBlur={(e) => void api.submitRename(e.target.value)}
              />
            </>
          ) : (
            <>
              {/*
                Full-bleed navigation overlay: the ONE navigating element for the
                whole row. `absolute inset-0` makes the entire row (icon, title,
                trailing padding band — everything not covered by the z-10 action
                cluster) a single click target, and a real <a href> is natively
                focusable so Enter/Space navigate for free. The visible icon+title
                layer below is `pointer-events-none` so clicks fall through to this
                anchor; the action cluster is stacked above it (z-10) so its own
                buttons keep receiving clicks. Fixes the v0.9.4 dead-zone regression
                where the Link was a flex-1 strip and the 44px action cluster bled
                over the 32px row (#150).
              */}
              <Link
                href={`/pages/${node.id}` as Route}
                aria-label={t('pageRow.open', { title: node.title })}
                draggable={false}
                className="absolute inset-0 rounded outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none">
                  {renderNodeIcon(node.icon)}
                </span>
                <span className="min-w-0 flex-1 truncate" title={node.title}>
                  {node.title}
                </span>
                {hasChildren ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                    {/* Visual badge is just the number; SRs get the localized
                        "{count} subpages" via the sibling sr-only text (plain
                        spans don't support aria-label). */}
                    <span data-child-count="" aria-hidden="true">
                      {node.childCount}
                    </span>
                    <span className="sr-only">
                      {t('sidebar.pages.childCount', { count: node.childCount })}
                    </span>
                  </span>
                ) : null}
              </div>
              <span
                data-row-actions=""
                className="relative z-10 shrink-0 opacity-30 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <PageRowActionsMenu node={node} api={api} />
              </span>
            </>
          )}
        </div>
      </PageRowContextMenu>
    </li>
  );
}
