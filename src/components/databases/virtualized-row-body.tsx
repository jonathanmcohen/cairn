'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { CellEditor } from './cell-editor';
import type { ColumnLayoutItem } from './column-ergonomics';
import type { VisibleNode } from './row-tree';
import type { RowData } from './use-database-data';

const ROW_HEIGHT_PX = 40; // matches the v0.6/v0.7 row visual (~ py-2.5 + 1px border)
const OVERSCAN = 6;

export type VirtualizedRowBodyProps = {
  columns: ColumnLayoutItem[];
  visible: VisibleNode[];
  rowDataById: Map<string, RowData>;
  collapsed: Set<string>;
  databaseId: string;
  onToggle: (id: string) => void;
  onChange: () => void;
  onAddChild: (parentId: string) => void;
  adding: boolean;
};

/**
 * Sticky header + windowed body. The classic `<table>`/`<tbody>` shape doesn't
 * pair well with `position: absolute` rows, so the body switches to a
 * `role="grid"` + `role="row"`/`role="cell"` ARIA shape. The header remains
 * inline-flex (same column widths) so frozen columns + horizontal scroll keep
 * working. Group-by rendering stays in `<TableView>` and is NOT virtualized
 * (groups are usually small).
 *
 * Used by `<TableView>` (v0.8 P5) to sustain 10k+ row databases without
 * mounting the full DOM. CellEditor + per-row toggle/add-child handlers are
 * unchanged.
 */
export function VirtualizedRowBody({
  columns,
  visible,
  rowDataById,
  collapsed,
  databaseId,
  onToggle,
  onChange,
  onAddChild,
  adding,
}: VirtualizedRowBodyProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN,
    getItemKey: (i) => visible[i]?.row.id ?? i,
    // Seed the viewport so the initial window isn't empty before the
    // ResizeObserver fires (matters for SSR hydration and jsdom tests where
    // layout never measures). 800x600 ≈ one table viewport on a laptop.
    initialRect: { width: 800, height: 600 },
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: <table> cannot host position:absolute rows; this div is the grid container with ARIA grid semantics so screen readers still see a tabular structure.
    <div ref={scrollRef} className="relative h-full overflow-auto" role="grid">
      {/* Sticky header — inline style so jsdom tests can read position/top. */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: header row is a landmark for screen readers; rows are non-interactive (per-column sort/resize handles live in the toolbar, not the header row). */}
      {/* biome-ignore lint/a11y/useSemanticElements: cannot use <thead>/<tr> because the body uses position:absolute rows (table layout fights absolute positioning); ARIA grid semantics keep this accessible. */}
      <div
        data-virtual-header
        className="flex bg-card text-xs font-medium uppercase tracking-wide text-muted-foreground"
        style={{ position: 'sticky', top: '0px', zIndex: 2 }}
        role="row"
      >
        {columns.map((c) => (
          // biome-ignore lint/a11y/useFocusableInteractive: columnheader is a landmark role for screen readers; it is not user-interactive (no sort/resize handles yet), so tabIndex would only confuse focus order.
          // biome-ignore lint/a11y/useSemanticElements: <th> is forbidden outside a <table>, and this header sits in a div-based ARIA grid.
          <div
            key={c.id}
            role="columnheader"
            className="border-b px-3 py-2"
            style={{
              width: c.width,
              minWidth: c.width,
              ...(c.frozen && c.insetInlineStart !== null
                ? {
                    position: 'sticky',
                    insetInlineStart: `${c.insetInlineStart}px`,
                    zIndex: 3,
                    background: 'inherit',
                  }
                : null),
            }}
          >
            {c.prop.name}
          </div>
        ))}
      </div>

      {/* Spacer — total list height so the scrollbar reflects the full row count. */}
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const node = visible[vRow.index];
          if (!node) return null;
          const item = rowDataById.get(node.row.id);
          if (!item) return null;
          const isCollapsed = collapsed.has(node.row.id);
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: row receives keyboard focus through inner <CellEditor> controls, not the row itself; long-press/right-click is wired in <TableView>. Adding tabIndex here would hijack tab order through the entire viewport.
            // biome-ignore lint/a11y/useSemanticElements: <tr> requires a parent <table>; the windowed body cannot use a table because position:absolute rows fight table layout. ARIA grid semantics preserve screen-reader support.
            <div
              key={node.row.id}
              data-virtual-row
              role="row"
              className="flex border-b hover:bg-accent/40"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${vRow.size}px`,
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {columns.map((c, i) => (
                // biome-ignore lint/a11y/useSemanticElements: <td> requires a parent <tr>/<table>; the windowed body uses div-based ARIA grid semantics so position:absolute rows can lay out correctly.
                <div
                  key={c.id}
                  role="cell"
                  className={c.frozen ? 'bg-card px-3 py-2.5' : 'px-3 py-2.5'}
                  style={{
                    width: c.width,
                    minWidth: c.width,
                    ...(c.frozen && c.insetInlineStart !== null
                      ? {
                          position: 'sticky',
                          insetInlineStart: `${c.insetInlineStart}px`,
                          zIndex: 1,
                        }
                      : null),
                  }}
                >
                  {i === 0 ? (
                    <span
                      style={{ paddingInlineStart: `${node.depth * 1.25}rem` }}
                      className="inline-flex items-center gap-1"
                    >
                      {node.hasChildren ? (
                        <button
                          type="button"
                          aria-label={isCollapsed ? 'Expand row' : 'Collapse row'}
                          aria-expanded={!isCollapsed}
                          onClick={() => onToggle(node.row.id)}
                          className="size-4 shrink-0 text-muted-foreground"
                        >
                          {isCollapsed ? '▸' : '▾'}
                        </button>
                      ) : (
                        <span className="size-4 shrink-0" aria-hidden="true" />
                      )}
                      <CellEditor
                        databaseId={databaseId}
                        rowId={item.row.id}
                        property={c.prop}
                        value={item.cells[c.id]}
                        onSaved={onChange}
                      />
                      <button
                        type="button"
                        aria-label="Add sub-item"
                        disabled={adding}
                        onClick={() => onAddChild(node.row.id)}
                        className="ml-1 shrink-0 text-xs text-muted-foreground opacity-0 hover:bg-accent focus:opacity-100 group-hover:opacity-100"
                      >
                        +
                      </button>
                    </span>
                  ) : (
                    <CellEditor
                      databaseId={databaseId}
                      rowId={item.row.id}
                      property={c.prop}
                      value={item.cells[c.id]}
                      onSaved={onChange}
                    />
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
