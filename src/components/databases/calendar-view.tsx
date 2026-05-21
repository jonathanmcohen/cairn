'use client';

import { useState } from 'react';
import { bucketRowsByDay, monthGrid } from '@/lib/databases/calendar-grid';
import type { ViewProps } from './table-view';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarView({ databaseId, meta, rows, view, onChange }: ViewProps) {
  const config = (view.config ?? {}) as { dateProperty?: string | null };
  const dateProp = meta.properties.find((p) => p.id === config.dateProperty);

  // Anchor: first of the current month (UTC).
  const today = new Date();
  const [anchor, setAnchor] = useState(
    () => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
  );

  if (!dateProp || dateProp.type !== 'date') {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Configure a date property to use the calendar view.
      </div>
    );
  }

  const datePropId = dateProp.id;
  const cells = monthGrid(anchor);
  const buckets = bucketRowsByDay(rows, datePropId);
  const titleProp = meta.properties.find((p) => p.type === 'text') ?? meta.properties[0];

  function rowTitle(cellsMap: Record<string, unknown>): string {
    if (!titleProp) return 'Untitled';
    const v = cellsMap[titleProp.id];
    return typeof v === 'string' && v.length > 0 ? v : 'Untitled';
  }

  function shiftMonth(delta: number) {
    setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + delta, 1)));
  }

  async function addRowOnDay(dayKeyStr: string) {
    await fetch(`/api/databases/${databaseId}/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cells: { [datePropId]: `${dayKeyStr}T00:00:00.000Z` },
      }),
    });
    onChange();
  }

  const monthLabel = anchor.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">{monthLabel}</div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            ‹ Prev
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            Next ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px rounded-md bg-border text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-muted/40 px-2 py-1 font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((c) => {
          const dayRows = buckets.get(c.key) ?? [];
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => void addRowOnDay(c.key)}
              className={`flex min-h-20 flex-col gap-1 bg-background p-1 text-left align-top hover:bg-accent/40 ${
                c.inMonth ? '' : 'text-muted-foreground/50'
              }`}
            >
              <span className="px-1 text-[10px]">{c.date.getUTCDate()}</span>
              {dayRows.map((r) => (
                <span
                  key={r.row.id}
                  className="truncate rounded bg-primary/10 px-1 py-0.5 text-[11px] text-foreground"
                >
                  {rowTitle(r.cells)}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
