'use client';
import type { ViewProps } from './table-view';

export function GalleryView({ rows }: ViewProps) {
  return (
    <div className="p-2 text-sm text-muted-foreground">
      Gallery view: {rows.length} rows. (Full UI in Task 14.)
    </div>
  );
}
