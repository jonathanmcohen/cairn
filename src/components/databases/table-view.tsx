'use client';

import { useState } from 'react';
import { groupRows } from '@/lib/databases/group';
import { CellEditor } from './cell-editor';
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

  const config = (view.config ?? {}) as { groupBy?: string | null };
  const groupByProp = meta.properties.find((p) => p.id === config.groupBy);
  const grouped = groupByProp?.type === 'select';

  async function addRow() {
    setAdding(true);
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
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
    body = (
      <tbody>
        {rows.map((r) => rowTr(r))}
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
        onClick={addRow}
        disabled={adding}
        className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
      >
        + New row
      </button>
    </div>
  );
}
