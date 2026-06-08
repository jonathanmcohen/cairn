'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { EmptyPageTree } from '@/components/empty-state/variants';
import { InlineIcon } from '@/components/page-icon-inline';
import { useT } from '@/lib/i18n/provider';
import type { FlatPageNode } from '@/lib/pages/tree';
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

export const ROW_HEIGHT_PX = 26; // Compact dense row (#208).
const DEPTH_INDENT_PX = 16; // 16px per level; matches the v0.7 visual.
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
   *  toggle state applies. */
  collapseAll?: boolean;
}) {
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

  const rows = useMemo(() => {
    const allRows = buildRows(initial, spaces);
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
  }, [initial, spaces, collapsed, collapseAll]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]?.key ?? index,
    // Seed the viewport so the initial render window isn't empty before the
    // ResizeObserver fires (matters for SSR hydration and jsdom tests where
    // layout never measures). 600px ≈ one sidebar viewport on a laptop.
    initialRect: { width: 240, height: 600 },
  });

  if (initial.length === 0) {
    return (
      <div className="px-2 py-4">
        <EmptyPageTree />
      </div>
    );
  }

  return (
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
                    {row.icon ?? <Folder className="inline h-3 w-3" />}
                  </span>
                  <span className="truncate" title={row.name}>
                    {row.name}
                  </span>
                </button>
              </li>
            );
          }
          const node = row.page;
          return <PageTreeRow key={row.key} node={node} rowKey={row.key} style={baseStyle} />;
        })}
      </ul>
    </div>
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
 * never `hidden`) so it remains keyboard- and SR-reachable. The action hook is
 * called exactly once here so inline-rename state lives in the row (the title
 * `<span>` swaps for an `<input>` while renaming).
 */
function PageTreeRow({
  node,
  rowKey,
  style,
}: {
  node: FlatPageNode;
  rowKey: string;
  style: React.CSSProperties;
}) {
  const t = useT();
  const api = usePageRowActions(node);
  return (
    <li key={rowKey} data-virtual-row="" data-row-kind="page" data-depth={node.depth} style={style}>
      <PageRowContextMenu node={node} api={api}>
        <div
          className="group relative flex items-center gap-1.5 rounded pr-1 text-[length:var(--cairn-sidebar-text)] leading-[var(--cairn-sidebar-leading)] tracking-[0.1px] hover:bg-accent focus-within:bg-accent"
          style={{ paddingLeft: `${node.depth * DEPTH_INDENT_PX + 8}px` }}
        >
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
                className="absolute inset-0 rounded outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none">
                  {renderNodeIcon(node.icon)}
                </span>
                <span className="min-w-0 flex-1 truncate" title={node.title}>
                  {node.title}
                </span>
              </div>
              <span
                data-row-actions=""
                className="relative z-10 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
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
