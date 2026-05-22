'use client';

import { useState } from 'react';
import { groupRows } from '@/lib/databases/group';
import { CellEditor } from './cell-editor';
import { buildRowForest, flattenVisible } from './row-tree';
import type { DatabaseMeta, RowData } from './use-database-data';

export type ViewProps = {
  databaseId: string;
  meta: DatabaseMeta;
  rows: RowData[];
  view: { id: string; type: string; name: string; config: unknown };
  onChange: () => void;
};

export function TableView({ databaseId, meta, rows, view, onChange }: ViewProps) {
  const [adding, setAdding] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const config = (view.config ?? {}) as { groupBy?: string | null };
  const groupByProp = meta.properties.find((p) => p.id === config.groupBy);
  const grouped = groupByProp?.type === 'select';

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

  function rowTr(r: RowData) {
    return (
      <tr key={r.row.id} className="border-b hover:bg-accent/40">
        {meta.properties.map((p) => (
          <td key={p.id} className="px-3 py-1.5">
            <CellEditor
              databaseId={databaseId}
              rowId={r.row.id}
              property={p}
              value={r.cells[p.id]}
              onSaved={onChange}
            />
          </td>
        ))}
      </tr>
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
            colSpan={meta.properties.length}
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
            <tr key={node.row.id} className="border-b hover:bg-accent/40">
              {meta.properties.map((p, i) => (
                <td key={p.id} className="px-3 py-1.5">
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
                        property={p}
                        value={item.cells[p.id]}
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
                      property={p}
                      value={item.cells[p.id]}
                      onSaved={onChange}
                    />
                  )}
                </td>
              ))}
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={meta.properties.length}
              className="px-3 py-4 text-center text-muted-foreground"
            >
              No rows yet.
            </td>
          </tr>
        )}
      </tbody>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            {meta.properties.map((p) => (
              <th key={p.id} className="px-3 py-2 text-left font-medium">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        {body}
      </table>
      <button
        type="button"
        onClick={() => void addRow()}
        disabled={adding}
        className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
      >
        + New row
      </button>
    </div>
  );
}
