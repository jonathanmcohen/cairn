'use client';

import type { ViewProps } from './table-view';

export function GalleryView({ meta, rows }: ViewProps) {
  const titleProp = meta.properties.find((p) => p.type === 'text') ?? meta.properties[0];
  const otherProps = meta.properties.filter((p) => p.id !== titleProp?.id);

  function renderValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? '✓' : '';
    return String(value);
  }

  if (rows.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No rows yet.</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => {
        const title = titleProp ? renderValue(r.cells[titleProp.id]) : '';
        return (
          <div key={r.row.id} className="rounded-md border bg-background p-3 shadow-sm">
            <div className="mb-2 font-medium">{title || 'Untitled'}</div>
            <dl className="space-y-1">
              {otherProps.map((p) => {
                const val = renderValue(r.cells[p.id]);
                if (!val) return null;
                return (
                  <div key={p.id} className="flex gap-2 text-xs">
                    <dt className="text-muted-foreground">{p.name}:</dt>
                    <dd>{val}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
