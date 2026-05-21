'use client';

import { useState } from 'react';
import { CellEditor } from './cell-editor';
import type { DatabaseMeta, RowData } from './use-database-data';

export type ViewProps = {
  databaseId: string;
  meta: DatabaseMeta;
  rows: RowData[];
  view: { id: string; type: string; name: string; config: unknown };
  onChange: () => void;
};

export function TableView({ databaseId, meta, rows, onChange }: ViewProps) {
  const [adding, setAdding] = useState(false);

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
        <tbody>
          {rows.map((r) => (
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
          ))}
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
