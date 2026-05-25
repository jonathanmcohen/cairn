'use client';

import { PullToRefresh } from '@/components/mobile/pull-to-refresh';
import { dayKey } from '@/lib/databases/calendar-grid';
import type { ViewProps } from './table-view';

const DAY_MS = 86_400_000;

function toMs(value: unknown): number | null {
  const key = dayKey(value);
  return key === null ? null : new Date(`${key}T00:00:00.000Z`).getTime();
}

export function TimelineView({ meta, rows, view, onChange }: ViewProps) {
  const config = (view.config ?? {}) as {
    dateProperty?: string | null;
    startProperty?: string | null;
    endProperty?: string | null;
  };

  // Resolve the date axis: a span (start/end) takes precedence, else a single point.
  const startId = config.startProperty ?? config.dateProperty ?? null;
  const endId = config.endProperty ?? config.dateProperty ?? null;
  const hasAxis =
    !!startId &&
    !!endId &&
    meta.properties.some((p) => p.id === startId && p.type === 'date') &&
    meta.properties.some((p) => p.id === endId && p.type === 'date');

  if (!hasAxis || startId === null || endId === null) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Configure a date property (or a start/end pair) to use the timeline view.
      </div>
    );
  }

  const titleProp = meta.properties.find((p) => p.type === 'text') ?? meta.properties[0];

  // Build bars; drop rows with no usable start.
  const bars = rows
    .map((r) => {
      const start = toMs(r.cells[startId]);
      if (start === null) return null;
      const end = toMs(r.cells[endId]) ?? start;
      const title =
        titleProp && typeof r.cells[titleProp.id] === 'string'
          ? (r.cells[titleProp.id] as string)
          : 'Untitled';
      return { id: r.row.id, start, end: Math.max(end, start + DAY_MS), title };
    })
    .filter((b): b is { id: string; start: number; end: number; title: string } => b !== null);

  if (bars.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No rows with a date to place.</div>;
  }

  const min = Math.min(...bars.map((b) => b.start));
  const max = Math.max(...bars.map((b) => b.end));
  const span = Math.max(max - min, DAY_MS);

  return (
    <PullToRefresh onRefresh={async () => onChange()}>
      <div className="overflow-x-auto p-3">
        <div className="min-w-[640px] space-y-1">
          <div className="mb-2 flex justify-between text-[10px] text-muted-foreground">
            <span>{new Date(min).toISOString().slice(0, 10)}</span>
            <span>{new Date(max).toISOString().slice(0, 10)}</span>
          </div>
          {bars.map((b) => {
            const left = ((b.start - min) / span) * 100;
            const width = Math.max(((b.end - b.start) / span) * 100, 2);
            return (
              <div key={b.id} className="relative h-7 rounded bg-muted/30">
                <div
                  className="absolute top-0 flex h-7 items-center overflow-hidden rounded bg-primary/20 px-2 text-xs"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={b.title}
                >
                  <span className="truncate">{b.title}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Drag-to-reschedule is not available in this version (read-only timeline).
        </p>
      </div>
    </PullToRefresh>
  );
}
