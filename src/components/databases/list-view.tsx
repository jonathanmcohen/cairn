'use client';

import { useState } from 'react';
import { groupRows } from '@/lib/databases/group';
import type { ViewProps } from './table-view';

export function ListView({ databaseId, meta, rows, view, onChange }: ViewProps) {
  const [adding, setAdding] = useState(false);
  const config = (view.config ?? {}) as { groupBy?: string | null };
  const groupByProp = meta.properties.find((p) => p.id === config.groupBy);
  const titleProp = meta.properties.find((p) => p.type === 'text') ?? meta.properties[0];

  function rowTitle(cells: Record<string, unknown>): string {
    if (!titleProp) return 'Untitled';
    const v = cells[titleProp.id];
    return typeof v === 'string' && v.length > 0 ? v : 'Untitled';
  }

  async function addRow(groupValue?: string) {
    setAdding(true);
    const body = groupByProp && groupValue ? { cells: { [groupByProp.id]: groupValue } } : {};
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setAdding(false);
    onChange();
  }

  function Row({ cells }: { cells: Record<string, unknown> }) {
    return (
      <div className="flex items-center gap-3 rounded border bg-background px-3 py-2 text-sm">
        <span className="font-medium">{rowTitle(cells)}</span>
        <span className="ml-auto flex gap-3 text-xs text-muted-foreground">
          {meta.properties
            .filter((p) => p.id !== titleProp?.id)
            .map((p) => {
              const v = cells[p.id];
              const text =
                v === null || v === undefined
                  ? ''
                  : typeof v === 'object'
                    ? JSON.stringify(v)
                    : String(v);
              return text ? (
                <span key={p.id} className="truncate">
                  {text}
                </span>
              ) : null;
            })}
        </span>
      </div>
    );
  }

  if (groupByProp && groupByProp.type === 'select') {
    const options =
      (groupByProp.config as { options?: { id: string; name: string }[] })?.options ?? [];
    const groups = groupRows(rows, groupByProp.id, options);
    return (
      <div className="flex flex-col gap-4 p-3">
        {groups.map((g) => (
          <div key={g.id || 'uncategorized'} className="flex flex-col gap-1">
            <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {g.name} · {g.rows.length}
            </div>
            <div className="flex flex-col gap-1">
              {g.rows.map((r) => (
                <Row key={r.row.id} cells={r.cells} />
              ))}
            </div>
            <button
              type="button"
              disabled={adding}
              onClick={() => void addRow(g.id || undefined)}
              className="self-start rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              + Add
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      {rows.map((r) => (
        <Row key={r.row.id} cells={r.cells} />
      ))}
      {rows.length === 0 && (
        <div className="px-1 py-4 text-sm text-muted-foreground">No rows yet.</div>
      )}
      <button
        type="button"
        disabled={adding}
        onClick={() => void addRow()}
        className="self-start rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
      >
        + Add
      </button>
    </div>
  );
}
