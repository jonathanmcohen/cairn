'use client';

import { type ReactNode, useRef, useState } from 'react';
import { useLongPress } from '@/components/mobile/long-press';
import { useActionAllowed } from '@/components/pwa/offline-context';
import type { CalcFn } from '@/lib/databases/calc-footer';
import { groupRows } from '@/lib/databases/group';
import { applyRowTemplate, listRowTemplates } from '@/lib/databases/row-templates';
import { CalcFooterRow } from './calc-footer-row';
import { CellEditor } from './cell-editor';
import { columnLayout } from './column-ergonomics';
import { buildRowForest, flattenVisible } from './row-tree';
import type { DatabaseMeta, RowData } from './use-database-data';

export type ViewProps = {
  databaseId: string;
  meta: DatabaseMeta;
  rows: RowData[];
  view: { id: string; type: string; name: string; config: unknown };
  onChange: () => void;
};

/**
 * <tr> with a long-press → context-menu sheet (mobile users get Delete /
 * Duplicate / Open without the right-click affordance). Sheet anchors to the
 * row via `position: absolute` and dismisses on outside click.
 */
function LongPressRow({
  databaseId,
  rowId,
  onChange,
  className,
  children,
}: {
  databaseId: string;
  rowId: string;
  onChange: () => void;
  className?: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useLongPress(rowRef, { onLongPress: () => setMenuOpen(true) });

  async function onDelete() {
    setMenuOpen(false);
    if (!window.confirm('Delete this row?')) return;
    await fetch(`/api/databases/${databaseId}/rows/${rowId}`, { method: 'DELETE' });
    onChange();
  }

  async function onDuplicate() {
    setMenuOpen(false);
    // Reuse the bulk-create endpoint shape: POST /rows with no body creates a
    // blank row. A true "duplicate" would copy cells; defer to a future plan
    // (the API doesn't expose a single-row clone today).
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    onChange();
  }

  return (
    <tr ref={rowRef} className={className} style={{ position: 'relative' }}>
      {children}
      {menuOpen ? (
        <td
          aria-hidden="true"
          style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, padding: 0 }}
        >
          <div
            role="dialog"
            aria-label="Row actions"
            className="w-44 rounded-md border bg-popover py-1 shadow-md"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => void onDuplicate()}
            >
              Duplicate row
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent"
              onClick={() => void onDelete()}
            >
              Delete row
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

export function TableView({ databaseId, meta, rows, view, onChange }: ViewProps) {
  const [adding, setAdding] = useState(false);
  const rowMutateAllowed = useActionAllowed('db-row-mutate');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const config = (view.config ?? {}) as {
    groupBy?: string | null;
    calcFooter?: Record<string, CalcFn>;
    columnWidths?: Record<string, number>;
    frozenColumnIds?: string[];
    hiddenColumnIds?: string[];
  };
  const calcFooter = config.calcFooter ?? {};
  const groupByProp = meta.properties.find((p) => p.id === config.groupBy);
  const grouped = groupByProp?.type === 'select';

  const columns = columnLayout(meta.properties, {
    columnWidths: config.columnWidths ?? {},
    frozenColumnIds: config.frozenColumnIds ?? [],
    hiddenColumnIds: config.hiddenColumnIds ?? [],
  });

  const templates = listRowTemplates(meta.database.config);

  async function addRow(parentRowId?: string) {
    setAdding(true);
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parentRowId ? { parentRowId } : {}),
    });
    setAdding(false);
    onChange();
  }

  async function addRowFromTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    // applyRowTemplate also returns a `content` seed, but createRow only accepts
    // `cells` today — so only the cell defaults are wired.
    const { cells } = applyRowTemplate(template);
    setAdding(true);
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cells }),
    });
    setAdding(false);
    onChange();
  }

  function rowTr(r: RowData) {
    return (
      <LongPressRow
        key={r.row.id}
        databaseId={databaseId}
        rowId={r.row.id}
        onChange={onChange}
        className="border-b hover:bg-accent/40"
      >
        {columns.map((c) => {
          const stickyStyle =
            c.frozen && c.insetInlineStart !== null
              ? {
                  position: 'sticky' as const,
                  insetInlineStart: `${c.insetInlineStart}px`,
                  zIndex: 1,
                }
              : undefined;
          return (
            <td
              key={c.id}
              style={stickyStyle}
              className={c.frozen ? 'bg-card px-3 py-2.5' : 'px-3 py-2.5'}
            >
              <CellEditor
                databaseId={databaseId}
                rowId={r.row.id}
                property={c.prop}
                value={r.cells[c.id]}
                onSaved={onChange}
              />
            </td>
          );
        })}
      </LongPressRow>
    );
  }

  let body: React.ReactNode;
  if (grouped && groupByProp) {
    const options =
      (groupByProp.config as { options?: { id: string; name: string }[] })?.options ?? [];
    const groups = groupRows(rows, groupByProp.id, options);
    body = groups.map((g) => (
      <tbody key={g.id || 'uncategorized'}>
        <tr className="border-b bg-muted/40">
          <td
            colSpan={columns.length}
            className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {g.name} · {g.rows.length}
          </td>
        </tr>
        {g.rows.map((r) => rowTr(r))}
      </tbody>
    ));
  } else {
    const rowById = new Map(rows.map((r) => [r.row.id, r]));
    const forest = buildRowForest(
      rows.map((r) => ({ id: r.row.id, parentRowId: r.row.parentRowId })),
    );
    const visible = flattenVisible(forest, collapsed);
    body = (
      <tbody>
        {visible.map((node) => {
          const item = rowById.get(node.row.id);
          if (!item) return null;
          const isCollapsed = collapsed.has(node.row.id);
          return (
            <LongPressRow
              key={node.row.id}
              databaseId={databaseId}
              rowId={node.row.id}
              onChange={onChange}
              className="border-b hover:bg-accent/40"
            >
              {columns.map((c, i) => {
                const stickyStyle =
                  c.frozen && c.insetInlineStart !== null
                    ? {
                        position: 'sticky' as const,
                        insetInlineStart: `${c.insetInlineStart}px`,
                        zIndex: 1,
                      }
                    : undefined;
                return (
                  <td
                    key={c.id}
                    style={stickyStyle}
                    className={c.frozen ? 'bg-card px-3 py-2.5' : 'px-3 py-2.5'}
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
                            onClick={() => toggle(node.row.id)}
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
                          onClick={() => void addRow(node.row.id)}
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
                  </td>
                );
              })}
            </LongPressRow>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="px-3 py-4 text-center text-muted-foreground">
              No rows yet.
            </td>
          </tr>
        )}
      </tbody>
    );
  }

  return (
    <div className="-mx-1 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <colgroup>
          {columns.map((c) => (
            <col key={c.id} style={{ width: `${c.width}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b">
            {columns.map((c) => {
              const stickyStyle =
                c.frozen && c.insetInlineStart !== null
                  ? {
                      position: 'sticky' as const,
                      insetInlineStart: `${c.insetInlineStart}px`,
                      zIndex: 1,
                    }
                  : undefined;
              return (
                <th
                  key={c.id}
                  scope="col"
                  style={stickyStyle}
                  className={
                    c.frozen
                      ? 'bg-card px-3 py-2 text-left font-medium'
                      : 'px-3 py-2 text-left font-medium'
                  }
                >
                  {c.prop.name}
                </th>
              );
            })}
          </tr>
        </thead>
        {body}
        <CalcFooterRow
          databaseId={databaseId}
          viewId={view.id}
          viewConfig={view.config}
          meta={meta}
          rows={rows}
          calcFooter={calcFooter}
          onChange={onChange}
        />
      </table>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => void addRow()}
          disabled={adding || !rowMutateAllowed}
          title={rowMutateAllowed ? undefined : 'Unavailable offline'}
          className="flex-1 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
        >
          + New row
        </button>
        {templates.length > 0 && (
          <select
            aria-label="New row from template"
            value=""
            disabled={adding || !rowMutateAllowed}
            title={rowMutateAllowed ? undefined : 'Unavailable offline'}
            onChange={(e) => {
              const id = e.target.value;
              if (id) void addRowFromTemplate(id);
            }}
            className="px-2 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            <option value="">Templates…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
