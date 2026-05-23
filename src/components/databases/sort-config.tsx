'use client';

import { useState } from 'react';
import type { ViewProps } from './table-view';

type Sort = { propertyId: string; direction: 'asc' | 'desc' };

export function SortConfig({ databaseId, meta, view, onChange }: ViewProps) {
  const config = (view.config ?? {}) as { sorts?: Sort[] };
  const [open, setOpen] = useState(false);
  const sorts: Sort[] = Array.isArray(config.sorts) ? config.sorts : [];
  // Computed/relation-derived columns can't be sorted; offer real columns only.
  const sortable = meta.properties.filter((p) => p.type !== 'formula' && p.type !== 'rollup');

  async function save(next: Sort[]) {
    await fetch(`/api/databases/${databaseId}/views/${view.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { ...(view.config ?? {}), sorts: next } }),
    });
    onChange();
  }

  function addSort() {
    const first = sortable[0];
    if (!first) return;
    void save([...sorts, { propertyId: first.id, direction: 'asc' }]);
  }
  function removeSort(i: number) {
    void save(sorts.filter((_, idx) => idx !== i));
  }
  function setSort(i: number, patch: Partial<Sort>) {
    void save(sorts.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= sorts.length) return;
    const next = [...sorts];
    const tmp = next[i];
    const other = next[j];
    if (!tmp || !other) return;
    next[i] = other;
    next[j] = tmp;
    void save(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
      >
        Sort{sorts.length > 0 ? ` · ${sorts.length}` : ''}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-md border bg-background p-2 shadow-md">
          {sorts.length === 0 && (
            <div className="px-1 py-1 text-xs text-muted-foreground">No sorts.</div>
          )}
          {sorts.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: sort keys are positional and reorderable, with no stable id
            <div key={`${s.propertyId}-${i}`} className="mb-1 flex items-center gap-1 text-xs">
              <select
                aria-label="Sort by property"
                value={s.propertyId}
                onChange={(e) => setSort(i, { propertyId: e.target.value })}
                className="flex-1 rounded border bg-background px-1 py-0.5"
              >
                {sortable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSort(i, { direction: s.direction === 'asc' ? 'desc' : 'asc' })}
                className="rounded border px-1 py-0.5"
              >
                {s.direction === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
              <button
                type="button"
                onClick={() => move(i, -1)}
                className="rounded px-1 py-0.5 hover:bg-accent"
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                className="rounded px-1 py-0.5 hover:bg-accent"
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeSort(i)}
                className="rounded px-1 py-0.5 hover:bg-accent"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={sortable.length === 0}
            onClick={addSort}
            className="mt-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            + Add sort
          </button>
        </div>
      )}
    </div>
  );
}
