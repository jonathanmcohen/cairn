'use client';

import { useState } from 'react';
import type { ViewProps } from './table-view';

export function KanbanView({ databaseId, meta, rows, view, onChange }: ViewProps) {
  const [dragRowId, setDragRowId] = useState<string | null>(null);

  const config = (view.config ?? {}) as { groupBy?: string | null };
  const groupByProp = meta.properties.find((p) => p.id === config.groupBy);

  if (!groupByProp || groupByProp.type !== 'select') {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Configure a “group by” select property to use the kanban view.
      </div>
    );
  }

  const groupByPropId = groupByProp.id;
  const options =
    (groupByProp.config as { options?: { id: string; name: string }[] })?.options ?? [];
  // Columns: each option, plus an "Uncategorized" bucket for rows with no value.
  const columns = [{ id: '', name: 'Uncategorized' }, ...options];

  // Find the "title" property to show on each card (first text property, else first property).
  const titleProp = meta.properties.find((p) => p.type === 'text') ?? meta.properties[0];

  async function moveCard(rowId: string, newValue: string) {
    await fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cells: { [groupByPropId]: newValue || null } }),
    });
    onChange();
  }

  function cardTitle(cells: Record<string, unknown>): string {
    if (!titleProp) return 'Untitled';
    const v = cells[titleProp.id];
    return typeof v === 'string' && v.length > 0 ? v : 'Untitled';
  }

  return (
    <div className="flex gap-3 overflow-x-auto p-3">
      {columns.map((col) => {
        const colRows = rows.filter((r) => {
          const v = r.cells[groupByProp.id];
          return (col.id === '' && (v === null || v === undefined || v === '')) || v === col.id;
        });
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: kanban drop target; native HTML5 drag-and-drop has no equivalent interactive element/role
          <div
            key={col.id || 'uncategorized'}
            className="flex w-60 shrink-0 flex-col rounded-md bg-muted/40 p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragRowId) void moveCard(dragRowId, col.id);
              setDragRowId(null);
            }}
          >
            <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {col.name} · {colRows.length}
            </div>
            <div className="flex flex-col gap-2">
              {colRows.map((r) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: draggable kanban card; native HTML5 drag-and-drop has no equivalent interactive element/role
                <div
                  key={r.row.id}
                  draggable
                  onDragStart={() => setDragRowId(r.row.id)}
                  className="cursor-grab rounded border bg-background p-2 text-sm shadow-xs"
                >
                  {cardTitle(r.cells)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
